import asyncio, json
from playwright.async_api import async_playwright

async def test():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'])
        context = await browser.new_context(
            user_agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            viewport={'width': 1920, 'height': 1080},
            locale='ru-RU'
        )
        page = await context.new_page()

        # Try prematch with time filter
        print('Loading prematch...')
        await page.goto('https://betboom.ru/sport/prematch/table-tennis', timeout=30000, wait_until='domcontentloaded')
        await page.wait_for_timeout(2000)
        for sel in ['button:has-text("Ok")', 'button:has-text("Okey")']:
            try:
                btn = page.locator(sel).first
                if await btn.is_visible(timeout=2000):
                    await btn.click()
                    await page.wait_for_timeout(2000)
            except:
                pass
        await page.wait_for_timeout(10000)

        text = await page.evaluate('() => document.body.innerText')
        print('Prematch body length:', len(text))
        # Check if there's match content
        if 'TT Cup' in text or 'Setka Cup' in text:
            print('Found TT content in prematch!')
            print(text[:5000])
        else:
            print('No TT match content found in prematch page')
            # Try scrolling
            await page.evaluate('window.scrollTo(0, 500)')
            await page.wait_for_timeout(5000)
            text2 = await page.evaluate('() => document.body.innerText')
            print('After scroll, body length:', len(text2))
            if 'TT Cup' in text2 or 'Setka' in text2:
                print('Found after scroll!')
            else:
                # Try clicking on the TT filter in sidebar
                try:
                    tt_link = page.locator('text=Настольный теннис').first
                    if await tt_link.is_visible(timeout=3000):
                        await tt_link.click()
                        await page.wait_for_timeout(8000)
                        text3 = await page.evaluate('() => document.body.innerText')
                        print('After clicking TT link, length:', len(text3))
                        print(text3[:5000])
                except Exception as e:
                    print('Click TT link failed:', e)

        # Also try the main page URL which redirects
        print('\n\n=== Trying main URL ===')
        await page.goto('https://betboom.ru/sport/table-tennis', timeout=30000, wait_until='domcontentloaded')
        await page.wait_for_timeout(10000)
        text4 = await page.evaluate('() => document.body.innerText')
        if 'Не начался' in text4:
            print('Found upcoming matches on main page!')
            # Print just the upcoming section
            idx = text4.find('Не начался')
            if idx > 0:
                print(text4[max(0,idx-500):idx+500])
        else:
            print('Main URL final:', page.url)
            print('Text snippet:', text4[:2000])

        await browser.close()

asyncio.run(test())
