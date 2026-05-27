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

        await page.goto('https://betboom.ru/sport/live/table-tennis', timeout=30000, wait_until='domcontentloaded')
        await page.wait_for_timeout(2000)
        for sel in ['button:has-text("Ok")', 'button:has-text("Okey")']:
            try:
                btn = page.locator(sel).first
                if await btn.is_visible(timeout=2000):
                    await btn.click()
                    await page.wait_for_timeout(2000)
            except:
                pass
        await page.wait_for_timeout(8000)

        js_code = """
        () => {
            const bodyText = document.body.innerText;
            const lines = bodyText.split('\\n').map(l => l.trim()).filter(l => l);
            
            const playerRe = /^[A-Z\u0410-\u042f][a-z\u0430-\u044f]+(?:\\s+[A-Z\u0410-\u042f][a-z\u0430-\u044f]+(?:\\s+[A-Z\u0410-\u042f\u0410-\u042f])?)?$/;
            const scoreRe = /^\\d+$/;
            const floatRe = /^\\d+\\.\\d+$/;
            
            const leagues = ['TT Cup', 'TT Elite Series', 'Setka Cup', 'Liga Pro', 
                           'Win Cup', 'Premier TT', 'Pro Table Tennis'];
            
            let matches = [];
            let currentLeague = '';
            let i = 0;
            
            while (i < lines.length) {
                const line = lines[i];
                
                // Detect league header
                if (leagues.some(l => line.includes(l)) || 
                    (line.includes('.') && line.length > 5 && line.length < 40 &&
                     !scoreRe.test(line) && !floatRe.test(line) &&
                     !line.startsWith('\u041f') && !line.startsWith('\u0415\u0449\u0451'))) {
                    if (i + 1 < lines.length && /^\\d+$/.test(lines[i + 1])) {
                        currentLeague = line;
                        i += 2;
                        continue;
                    }
                }
                
                // Detect player name
                if (playerRe.test(line) && line.length > 2 && line.length < 50) {
                    const player1 = line;
                    if (i + 1 < lines.length && playerRe.test(lines[i + 1])) {
                        const player2 = lines[i + 1];
                        let j = i + 2;
                        let scores = [];
                        let status = '';
                        let odds1 = 0;
                        let odds2 = 0;
                        
                        while (j < lines.length && j < i + 15) {
                            const sl = lines[j];
                            if (playerRe.test(sl)) break;
                            if (scoreRe.test(sl) && sl.length < 3) {
                                scores.push(parseInt(sl));
                            } else if (sl.includes('\u0441\u0435\u0442') || sl.includes('\u041d\u0435 \u043d\u0430\u0447\u0430\u043b\u0441\u044f') || sl.includes('\u043d\u0435 \u043d\u0430\u0447\u0430\u043b\u043e\u0441\u044c')) {
                                status = sl;
                            } else if (sl === '\u041f1' && j + 1 < lines.length && floatRe.test(lines[j + 1])) {
                                odds1 = parseFloat(lines[j + 1]);
                                j++;
                            } else if (sl === '\u041f2' && j + 1 < lines.length && floatRe.test(lines[j + 1])) {
                                odds2 = parseFloat(lines[j + 1]);
                                j++;
                            } else if (sl.startsWith('\u0415\u0449\u0451')) {
                                break;
                            }
                            j++;
                        }
                        
                        if (odds1 > 0 && odds2 > 0) {
                            let s1 = scores.length >= 2 ? scores[0] : 0;
                            let s2 = scores.length >= 2 ? scores[1] : 0;
                            matches.push({
                                league: currentLeague,
                                player1: player1,
                                player2: player2,
                                score1: s1,
                                score2: s2,
                                allScores: scores,
                                status: status,
                                odds1: odds1,
                                odds2: odds2
                            });
                        }
                        i = j;
                        continue;
                    }
                }
                i++;
            }
            return matches;
        }
        """

        data = await page.evaluate(js_code)

        print('Extracted %d matches:' % len(data))
        print(json.dumps(data, ensure_ascii=False, indent=2))

        await browser.close()

asyncio.run(test())
