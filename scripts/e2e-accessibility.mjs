import puppeteer from 'puppeteer';
const base = process.env.E2E_BASE_URL;
const email = process.env.E2E_TEST_EMAIL;
const password = process.env.E2E_TEST_PASSWORD;
if (!base || !email || !password) throw new Error('E2E_BASE_URL, E2E_TEST_EMAIL and E2E_TEST_PASSWORD are required.');
if ((process.env.E2E_ENV ?? '') !== 'staging') throw new Error('Accessibility/RTL/mobile certification is staging-only. Set E2E_ENV=staging.');
const browser = await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
const page = await browser.newPage();
const results=[];
try {
  for (const profile of [
    {name:'desktop-en',width:1440,height:1000,lang:'en'},
    {name:'mobile-en',width:390,height:844,lang:'en'},
    {name:'mobile-ar',width:390,height:844,lang:'ar'},
    {name:'desktop-ar',width:1440,height:1000,lang:'ar'},
    {name:'desktop-fr',width:1440,height:1000,lang:'fr'},
  ]) {
    await page.setViewport({width:profile.width,height:profile.height,isMobile:profile.width<600,hasTouch:profile.width<600});
    const url = new URL(base); url.searchParams.set('lang',profile.lang);
    await page.goto(url.toString(),{waitUntil:'networkidle2'});
    const dir = await page.$eval('html', el => ({dir:el.getAttribute('dir')||'',lang:el.getAttribute('lang')||''}));
    if (profile.lang==='ar' && dir.dir!=='rtl') throw new Error(`${profile.name}: expected RTL dir=rtl`);
    if (profile.lang!=='ar' && dir.dir==='rtl') throw new Error(`${profile.name}: unexpected RTL direction`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    if (overflow) throw new Error(`${profile.name}: horizontal overflow detected`);
    const unlabeled = await page.evaluate(() => Array.from(document.querySelectorAll('button,input,select,textarea')).filter(el => !el.getAttribute('aria-label') && !(el.id && document.querySelector(`label[for="${el.id}"]`)) && !el.textContent?.trim() && !el.getAttribute('placeholder')).length);
    if (unlabeled > 0) throw new Error(`${profile.name}: ${unlabeled} unlabeled interactive controls`);
    results.push({profile:profile.name,pass:true,rtl:dir.dir,overflow:false});
  }
  console.log(JSON.stringify({pass:true,profiles:results.length,results},null,2));
} finally { await browser.close(); }
