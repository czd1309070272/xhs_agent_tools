import random

from .constants import CLOSE_PANEL, DETAIL_URL_KEYWORDS, FILTER_BTN, FILTER_COORDS


def on_response_search(tool, response):
    if not tool._active or not tool._collecting or 'search/notes' not in response.url:
        return
    try:
        data = response.json()
        items = data.get('data', {}).get('items', [])
        new = 0
        for item in items:
            if item.get('model_type') != 'note':
                continue
            pid = item.get('id')
            if not pid or pid in tool._seen_ids or pid in tool._global_seen_ids:
                continue
            tool._seen_ids.add(pid)
            tool._global_seen_ids.add(pid)
            tool._pending_cards.append(parse_card(item))
            new += 1
        if new:
            print(f'  [拦截] +{new} 条新卡片')
    except Exception:
        pass


def on_response_detail(tool, response):
    if not tool._active or not any(keyword in response.url for keyword in DETAIL_URL_KEYWORDS):
        return
    try:
        data = response.json()
        note = (
            data.get('data', {}).get('note_detail_map', {})
            or data.get('data', {}).get('items', [{}])[0]
            or data.get('data', {})
        )
        card = note.get('note_card') or note.get('noteInfo') or note
        content = card.get('desc') or card.get('description') or card.get('content') or ''
        tags = [
            tag.get('name') or tag.get('text')
            for tag in card.get('tag_list', [])
            if tag.get('name') or tag.get('text')
        ]
        if content:
            tool._detail_buffer[response.url] = {'content': content, 'tags': tags}
            print(f'  [详情拦截] 正文 {len(content)} 字')
    except Exception:
        pass


def parse_card(item: dict) -> dict:
    card = item.get('note_card', {})
    user = card.get('user', {})
    interact = card.get('interact_info', {})
    pub_time = ''
    for tag in card.get('corner_tag_info', []):
        if tag.get('type') == 'publish_time':
            pub_time = tag.get('text', '')
            break

    images = []
    for img in card.get('image_list', []):
        for info in img.get('info_list', []):
            if info.get('image_scene') == 'WB_DFT':
                images.append(info['url'])
                break

    return {
        'id': item.get('id', ''),
        'url': f'https://www.xiaohongshu.com/explore/{item.get("id", "")}',
        'title': card.get('display_title', ''),
        'type': card.get('type', ''),
        'author': user.get('nickname', ''),
        'author_id': user.get('user_id', ''),
        'publishedTime': pub_time,
        'likes': interact.get('liked_count', '0'),
        'comments': interact.get('comment_count', '0'),
        'collects': interact.get('collected_count', '0'),
        'shares': interact.get('shared_count', '0'),
        'images': images,
        'image_count': len(images),
        'content': '',
        'tags': [],
    }


def apply_filter(tool, page, sort='综合', note_type='不限', time_range='不限', search_scope='不限', location='不限'):
    tool._collecting = False
    page.evaluate('window.scrollTo(0, 0)')
    page.wait_for_timeout(random.randint(500, 800))
    tool._pending_cards = []
    tool._seen_ids = set()
    page.mouse.move(FILTER_BTN[0], FILTER_BTN[1])
    page.wait_for_timeout(random.randint(700, 1000))

    for value, key in [(sort, 'sort'), (note_type, 'type'), (time_range, 'time'), (search_scope, 'range'), (location, 'location')]:
        if value == '不限':
            continue
        coords = FILTER_COORDS.get(key, {}).get(value)
        if coords:
            print(f'  筛选 {key} → {value}')
            page.mouse.click(coords[0], coords[1])
            page.wait_for_timeout(random.randint(300, 500))

    page.mouse.click(CLOSE_PANEL[0], CLOSE_PANEL[1])
    page.wait_for_timeout(random.randint(1500, 2000))
    tool._pending_cards = []
    tool._seen_ids = set()
    tool._collecting = True
    print('  [筛选完成] 开始收集')


def check_captcha(page) -> bool:
    try:
        return page.evaluate("""
            () => {
                const el = document.querySelector(
                    '[class*="captcha"], [id*="captcha"], '
                    + '[class*="slider-verify"], [class*="slide-verify"], '
                    + '[class*="verify-wrap"], '
                    + 'canvas[id*="captcha"], canvas[class*="captcha"]'
                );
                return el !== null;
            }
        """)
    except Exception:
        return False


def wait_for_captcha(page):
    print('\n' + '!' * 55)
    print('! 检测到验证码，请在浏览器中手动完成验证')
    print('! 完成后按回车继续...')
    print('!' * 55)
    input()
    page.wait_for_timeout(2000)
    print('[继续] 验证完成，恢复搜索')


def mark_visible_cards(page):
    result = page.evaluate("""
        () => {
            const visible = [];
            const links = document.querySelectorAll('a[href*="/explore/"]');
            for (const link of links) {
                const href = link.getAttribute('href');
                const m = href.match(/\\/explore\\/([a-zA-Z0-9]+)/);
                if (!m) continue;
                const postId = m[1];
                let el = link;
                let cur = link.parentElement;
                for (let d = 0; d < 10; d++) {
                    if (!cur) break;
                    const r = cur.getBoundingClientRect();
                    if (r.width > 100 && r.height > 100) { el = cur; break; }
                    cur = cur.parentElement;
                }
                el.setAttribute('data-post-id', postId);
                visible.push(postId);
            }
            return visible;
        }
    """)
    return set(result)


def click_card(tool, page, card: dict) -> bool:
    tool._detail_buffer.clear()
    locator = page.locator(f'[data-post-id="{card["id"]}"]').first
    if locator.count() == 0:
        return False

    try:
        locator.scroll_into_view_if_needed(timeout=5000)
        page.wait_for_timeout(random.randint(200, 400))
        locator.click(timeout=8000)
        page.wait_for_timeout(random.randint(1200, 1800))

        if tool._check_captcha(page):
            tool._wait_for_captcha(page)

        page.wait_for_timeout(random.randint(500, 800))

        for entry in tool._detail_buffer.values():
            if entry.get('content'):
                card['content'] = entry['content']
                card['tags'] = entry.get('tags', [])
                break

        if not card['content']:
            card['content'] = page.evaluate("""
                () => {
                    const sels = ['#detail-desc', '[class*="note-content"]', '[class*="desc"]'];
                    for (const s of sels) {
                        const el = document.querySelector(s);
                        if (el && el.innerText.trim().length > 10) return el.innerText.trim();
                    }
                    return '';
                }
            """)

        page.keyboard.press('Escape')
        page.wait_for_timeout(random.randint(600, 1000))
        return True
    except Exception as error:
        print(f'  [ERROR] 点击失败: {error}')
        try:
            page.keyboard.press('Escape')
        except Exception:
            pass
        return False


def apply_score_filter_changes(tool, page, score_result: dict, sort: str, time_range: str, note_type: str, search_scope: str, location: str):
    new_sort = score_result.get('next_sort')
    new_time_range = score_result.get('next_time_range')
    changed = False

    if new_sort and new_sort in FILTER_COORDS.get('sort', {}) and new_sort != sort:
        print(f'  [筛选调整] sort: {sort} → {new_sort}')
        sort = new_sort
        changed = True
    if new_time_range and new_time_range in FILTER_COORDS.get('time', {}) and new_time_range != time_range:
        print(f'  [筛选调整] time_range: {time_range} → {new_time_range}')
        time_range = new_time_range
        changed = True
    if changed:
        apply_filter(tool, page, sort, note_type, time_range, search_scope, location)
    return sort, time_range, changed
