const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({headless: true});
  const page = await browser.newPage();
  const html = path.resolve('docx_qa_edith154_v1/preview.html');
  await page.goto('file:///' + html.replace(/\\/g, '/'), {waitUntil: 'load'});
  await page.pdf({path: path.resolve('docx_qa_edith154_v3/preview.pdf'), format: 'Letter', printBackground: true, margin: {top:'0in',right:'0in',bottom:'0in',left:'0in'}});
  await browser.close();
})();
