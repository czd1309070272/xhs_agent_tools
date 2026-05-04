def run_agent(tool, user_query: str, context) -> list[dict]:
    intent = tool.parse_intent(user_query)
    intent_context = intent.get('intent_context', {})
    raw_count = intent.get('count', 0)
    count_specified = raw_count > 0
    need = raw_count if count_specified else 5
    sort = intent.get('sort', '综合')
    note_type = intent.get('note_type', '不限')
    time_range = intent.get('time_range', '不限')
    search_scope = intent.get('search_scope', '不限')
    location = intent.get('location', '不限')
    filter_prompt = intent.get('filter_prompt', '')
    current_kw = intent.get('first_keyword', user_query)
    max_rounds = min(int(intent.get('max_rounds', 3)), 8)
    if count_specified and need > 1:
        max_rounds = max(max_rounds, 2)
    strategy_mode = 'explore'
    coverage_plan = ''

    tool._seen_ids = set()
    tool._global_seen_ids = set()
    tool._active = True
    tool._collecting = False
    results: list[dict] = []
    used_keywords: list[str] = []

    print(f'\n[XHS Agent] 目标 {need} 条')
    tool._on_search_started(need, current_kw)
    page = context.pages[0] if context.pages else context.new_page()
    page.on('response', tool._on_response_search)
    page.on('response', tool._on_response_detail)
    tool._prepare_search_page(page)

    for round_num in range(max_rounds):
        if len(results) >= need:
            break

        print(f'\n{"=" * 55}')
        print(f'轮次 {round_num + 1} | 关键词: {current_kw} | 已有: {len(results)}/{need}')
        print('=' * 55)
        tool._on_round_started(round_num + 1, current_kw, len(results), need)

        used_keywords.append(current_kw)
        tool._pending_cards = []
        clicked_this_round: list[dict] = []
        click_queue: set[str] = set()
        scored_buffer: list[dict] = []
        id_to_card: dict[str, dict] = {}
        score_batch = 5
        no_new_scrolls = 0

        page.goto(
            f'https://www.xiaohongshu.com/search_result?keyword={current_kw}',
            wait_until='domcontentloaded',
        )
        page.wait_for_timeout(3000)
        tool._apply_filter(page, sort, note_type, time_range, search_scope, location)

        for _scroll_step in range(20):
            if len(results) + len(clicked_this_round) >= need:
                break

            stop_scroll = False
            if tool._pending_cards:
                for card in tool._pending_cards:
                    id_to_card[card['id']] = card
                scored_buffer.extend(tool._pending_cards)
                tool._pending_cards = []
                no_new_scrolls = 0
            else:
                no_new_scrolls += 1
                if no_new_scrolls >= 3:
                    if scored_buffer:
                        tool._on_ai_thinking('score_cards', f'AI 正在为第 {round_num + 1} 轮筛选候选帖子', round_num + 1)
                        score_result = tool._llm_score_cards(
                            scored_buffer,
                            user_query,
                            filter_prompt,
                            already_have=len(results) + len(clicked_this_round),
                            need=need,
                            sort=sort,
                            time_range=time_range,
                            intent_context=intent_context,
                            existing_results=results,
                            strategy_mode=strategy_mode,
                            coverage_plan=coverage_plan,
                        )
                        click_queue.update(score_result['ids'])
                        scored_buffer = []
                        sort, time_range, changed = tool._apply_score_filter_changes(
                            page,
                            score_result,
                            sort,
                            time_range,
                            note_type,
                            search_scope,
                            location,
                        )
                        if changed:
                            id_to_card.clear()
                            click_queue.clear()
                    print('  连续3次无新卡片，停止滚动')
                    stop_scroll = True

            if len(scored_buffer) >= score_batch:
                tool._on_ai_thinking('score_cards', f'AI 正在为第 {round_num + 1} 轮筛选候选帖子', round_num + 1)
                score_result = tool._llm_score_cards(
                    scored_buffer,
                    user_query,
                    filter_prompt,
                    already_have=len(results) + len(clicked_this_round),
                    need=need,
                    sort=sort,
                    time_range=time_range,
                    intent_context=intent_context,
                    existing_results=results,
                    strategy_mode=strategy_mode,
                    coverage_plan=coverage_plan,
                )
                click_queue.update(score_result['ids'])
                scored_buffer = []
                sort, time_range, changed = tool._apply_score_filter_changes(
                    page,
                    score_result,
                    sort,
                    time_range,
                    note_type,
                    search_scope,
                    location,
                )
                if changed:
                    id_to_card.clear()
                    click_queue.clear()
                elif score_result['stop_scroll']:
                    stop_scroll = True

            if click_queue:
                visible_ids = tool._mark_visible_cards(page)
                to_click_now = click_queue & visible_ids
                for card_id in list(to_click_now):
                    card = id_to_card.get(card_id)
                    if not card:
                        click_queue.discard(card_id)
                        continue
                    print(f'  点击: {card["title"][:40]}')
                    ok = tool._click_card(page, card)
                    click_queue.discard(card_id)
                    if ok:
                        clicked_this_round.append(card)
                        print(f'  正文: {"有" if card["content"] else "无"}（{len(card["content"])} 字）')
                    tool._wait_after_card_click(page)
                    if len(results) + len(clicked_this_round) >= need:
                        break

            if stop_scroll:
                break

            page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
            tool._wait_after_scroll(page)

            if tool._check_captcha(page):
                tool._wait_for_captcha(page)

        if not clicked_this_round:
            print('本轮未点击任何帖子，LLM 给出下一关键词')
            tool._on_ai_thinking('evaluate_round', f'AI 正在复盘第 {round_num + 1} 轮并制定下一步策略', round_num + 1)
            decision = tool._llm_evaluate(
                user_query=user_query,
                filter_prompt=filter_prompt,
                new_posts=[],
                existing_results=results,
                need=need,
                used_keywords=used_keywords,
                current_sort=sort,
                current_time_range=time_range,
                intent_context=intent_context,
                count_specified=count_specified,
            )
        else:
            tool._on_ai_thinking('evaluate_round', f'AI 正在复盘第 {round_num + 1} 轮并制定下一步策略', round_num + 1)
            decision = tool._llm_evaluate(
                user_query=user_query,
                filter_prompt=filter_prompt,
                new_posts=clicked_this_round,
                existing_results=results,
                need=need,
                used_keywords=used_keywords,
                current_sort=sort,
                current_time_range=time_range,
                intent_context=intent_context,
                count_specified=count_specified,
            )

        strategy_mode = str(decision.get('strategy_mode') or strategy_mode or 'explore').strip() or 'explore'
        coverage_plan = str(decision.get('coverage_plan') or '').strip()
        tool._on_ai_decision(strategy_mode, coverage_plan, round_num + 1)

        accepted_ids = set(decision.get('accepted_ids', []))
        accepted = [card for card in clicked_this_round if card['id'] in accepted_ids]
        unique_accepted, duplicate_accepted = tool._filter_duplicate_titles(accepted, results)
        if duplicate_accepted:
            duplicate_titles = ' / '.join(post.get('title', '')[:20] or '（无标题）' for post in duplicate_accepted[:3])
            print(f'  [标题去重] 过滤重复标题 {len(duplicate_accepted)} 条: {duplicate_titles}')
        accepted = unique_accepted
        results.extend(accepted)
        print(f'本轮接受 {len(accepted)} 条，累计 {len(results)}/{need}')
        tool._on_round_completed(round_num + 1, len(accepted), len(results), need)

        if duplicate_accepted and len(results) < need:
            decision['satisfied'] = False

        if count_specified and len(results) < need and decision.get('satisfied'):
            print(f'  [修正] 用户指定 {need} 条，当前仅 {len(results)} 条，忽略 satisfied=true')
            decision['satisfied'] = False

        if decision.get('satisfied') or len(results) >= need:
            print('\n[Agent] 已满足需求，退出')
            break

        next_kw = decision.get('next_keyword', '').strip()
        if duplicate_accepted and len(results) < need and not next_kw:
            next_kw = current_kw
            print(f'  [标题去重续搜] 本轮命中重复标题，继续使用当前关键词: {next_kw}')
        if count_specified and len(results) < need and not next_kw:
            next_kw = current_kw
            print(f'  [兜底续搜] 目标数量未达成，继续使用当前关键词: {next_kw}')
        if not next_kw:
            print('[Agent] LLM 未给出下一关键词，退出')
            break
        current_kw = next_kw

        next_sort = decision.get('next_sort')
        next_time_range = decision.get('next_time_range')
        if next_sort and next_sort in tool.filter_coords.get('sort', {}):
            print(f'  [筛选调整] sort: {sort} → {next_sort}')
            sort = next_sort
        if next_time_range and next_time_range in tool.filter_coords.get('time', {}):
            print(f'  [筛选调整] time_range: {time_range} → {next_time_range}')
            time_range = next_time_range

    if count_specified and len(results) < need:
        print(f'\n[Agent] 已到最大轮次，目标 {need} 条，实际仅找到 {len(results)} 条')
    print(f'\n[完成] 返回 {len(results[:need])} 条')
    tool._active = False
    return results[:need]
