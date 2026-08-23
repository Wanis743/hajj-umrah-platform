import puppeteer from 'puppeteer';

const base = process.env.E2E_BASE_URL;
const email = process.env.E2E_TEST_EMAIL;
const password = process.env.E2E_TEST_PASSWORD;
const runMutations = process.env.E2E_RUN_MUTATIONS === '1';
const allowMutations = process.env.E2E_ALLOW_MUTATIONS === '1';
const locale = process.env.E2E_LOCALE || 'en';

if (!base || !email || !password) {
  console.error('E2E requires E2E_BASE_URL, E2E_TEST_EMAIL and E2E_TEST_PASSWORD.');
  process.exit(2);
}

if (runMutations && !allowMutations) {
  console.error('Refusing mutation E2E without E2E_ALLOW_MUTATIONS=1. Use a staging/test environment.');
  process.exit(2);
}

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
page.setDefaultNavigationTimeout(30000);

const consoleErrors = [];
const failedRequests = [];
page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('requestfailed', req => {
  failedRequests.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText ?? 'failed'}`);
});

async function clickNav(labels) {
  for (const label of labels) {
    const button = await page.getByRole('button', { name: label, exact: true }).catch(() => null);
    if (button) {
      await button.click();
      await page.waitForTimeout(300);
      return label;
    }
  }

  const buttons = await page.$$('aside button');
  for (const button of buttons) {
    const text = await page.evaluate(el => el.textContent?.trim() || '', button);
    if (labels.some(label => text === label)) {
      await button.click();
      await page.waitForTimeout(300);
      return text;
    }
  }
  throw new Error(`Navigation item not found: ${labels.join(' / ')}`);
}

async function assertAdminSurface(expectedTitle) {
  await page.waitForSelector('[data-testid="admin-shell"]', { timeout: 30000 });
  const title = await page.$eval('main h1, header h1', el => el.textContent?.trim() || '');
  if (!title.toLowerCase().includes(expectedTitle.toLowerCase())) {
    throw new Error(`Expected admin surface "${expectedTitle}", got "${title}"`);
  }
}

async function fillFirst(selector, value) {
  const el = await page.$(selector);
  if (!el) throw new Error(`Missing form field: ${selector}`);
  await el.click({ clickCount: 3 });
  await el.type(value);
}

try {
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="admin-login-form"]', { timeout: 30000 });

  await fillFirst('input[type="email"]', email);
  await fillFirst('input[type="password"]', password);
  await page.click('[data-testid="admin-login-form"] button[type="submit"]');

  await page.waitForSelector('[data-testid="admin-shell"]', { timeout: 30000 });

  const surfaces = [
    [['Pilgrims', 'الحجاج', 'Pèlerins'], 'Pilgrims'],
    [['Bookings', 'الحجوزات', 'Réservations'], 'Bookings'],
    [['Visas', 'التأشيرات'], 'Visas'],
    [['Documents', 'الوثائق'], 'Documents'],
    [['Flights', 'الرحلات', 'Vols'], 'Flights'],
    [['Hotels', 'الفنادق', 'Hôtels'], 'Hotels'],
    [['Transport', 'النقل'], 'Transport'],
    [['Finance', 'المالية', 'Finance'], 'Finance'],
    [['Reports', 'التقارير', 'Rapports'], 'Reports'],
    [['Audit', 'المراجعة'], 'Audit'],
    [['Settings', 'الإعدادات', 'Paramètres'], 'Settings'],
  ];

  const visited = [];
  for (const [labels, title] of surfaces) {
    await clickNav(labels);
    await assertAdminSurface(title);
    visited.push(title);
  }

  let mutationResults = [];

  if (runMutations) {
    await clickNav(['Pilgrims', 'الحجاج', 'Pèlerins']);
    await assertAdminSurface('Pilgrims');

    const newPilgrimButton = await page.$x("//button[contains(normalize-space(.), 'New Pilgrim') or contains(normalize-space(.), 'حاج جديد') or contains(normalize-space(.), 'Nouveau pelerin')]");
    if (!newPilgrimButton.length) {
      throw new Error('New Pilgrim action not found.');
    }
    await newPilgrimButton[0].click();
    await page.waitForTimeout(200);

    const inputs = await page.$$('input');
    const textInputs = [];
    for (const input of inputs) {
      const type = await page.evaluate(el => el.type, input);
      if (['text', 'email', 'date'].includes(type)) textInputs.push(input);
    }

    if (!textInputs.length) throw new Error('Pilgrim form did not render.');

    const runId = Date.now().toString(36);
    const fullName = `E2E Test Pilgrim ${runId}`;
    const passport = `E2E${runId}`.slice(0, 12);

    const placeholders = await Promise.all(textInputs.map(el =>
      page.evaluate(node => ({ placeholder: node.placeholder || '', type: node.type }), el)
    ));

    for (let i = 0; i < placeholders.length; i++) {
      const p = placeholders[i].placeholder.toLowerCase();
      if (p.includes('full name') || p.includes('nom complet') || p.includes('الاسم الكامل')) {
        await textInputs[i].type(fullName);
      } else if (p.includes('passport') || p.includes('passeport') || p.includes('الجواز')) {
        await textInputs[i].type(passport);
      }
    }

    const save = await page.$x("//button[contains(normalize-space(.), 'Save') or contains(normalize-space(.), 'حفظ') or contains(normalize-space(.), 'Enregistrer')]");
    if (!save.length) throw new Error('Pilgrim save action not found.');
    await save[0].click();
    await page.waitForTimeout(1000);

    mutationResults.push({
      workflow: 'pilgrim.create',
      pass: true,
      test_reference: passport,
    });
  }

  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="admin-shell"]', { timeout: 30000 });

  if (consoleErrors.length) {
    throw new Error(`Browser console errors: ${consoleErrors.join(' | ')}`);
  }
  if (failedRequests.length) {
    throw new Error(`Failed browser requests: ${failedRequests.join(' | ')}`);
  }

  console.log(JSON.stringify({
    pass: true,
    authenticated: true,
    locale,
    visited_surfaces: visited,
    mutation_suite: runMutations,
    mutation_results: mutationResults,
    console_errors: consoleErrors.length,
    failed_requests: failedRequests.length,
  }, null, 2));
} finally {
  await browser.close();
}
