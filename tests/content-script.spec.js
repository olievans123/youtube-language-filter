const { test, expect } = require('@playwright/test');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '..', 'content-script.js');
const ATTR = 'data-lang-filter-checked';

function videoEl(id, title) {
  return `<ytd-rich-item-renderer data-test-id="${id}">` +
    `<a href="/watch?v=${id}"><span id="video-title">${title}</span></a>` +
    `</ytd-rich-item-renderer>`;
}

function mixEl(id, mixLabel) {
  return `<ytd-rich-item-renderer data-test-id="${id}">` +
    `<a href="/watch?v=${id}&list=RD${id}" aria-label="${mixLabel}">Mix</a>` +
    `</ytd-rich-item-renderer>`;
}

async function setup(page, cfg, videos, { waitForAttr = true, html = null } = {}) {
  const defaults = { enabled: true, selectedLanguage: 'en', showUnknown: true };
  const merged = { ...defaults, ...cfg };

  const videoHTML = html ?? videos.map((v) => videoEl(v.id, v.title)).join('');
  await page.setContent(
    '<!DOCTYPE html><html><body>' + videoHTML + '</body></html>'
  );

  // Mock browser.runtime messaging (mirrors background.js behaviour)
  await page.evaluate((c) => {
    const mockAPI = {
      runtime: {
        sendMessage: (msg) => {
          if (msg && msg.type === 'getConfig') {
            return Promise.resolve(c);
          }
          return Promise.resolve();
        },
        onMessage: { addListener: () => {} }
      }
    };
    window.browser = mockAPI;
    window.chrome = mockAPI;
  }, merged);

  await page.addScriptTag({ path: SCRIPT });

  if (waitForAttr) {
    await page.waitForFunction(
      (attr) => {
        const els = document.querySelectorAll('ytd-rich-item-renderer');
        return els.length > 0 &&
          Array.from(els).every((el) => el.hasAttribute(attr));
      },
      ATTR,
      { timeout: 5000 }
    );
  }
}

function el(page, id) {
  return page.locator(`[data-test-id="${id}"]`);
}

// ---------------------------------------------------------------------------
// Detection tests
// ---------------------------------------------------------------------------

test.describe('language detection', () => {
  test('detects Chinese from CJK title', async ({ page }) => {
    await setup(page, { selectedLanguage: 'zh' }, [
      { id: 'v1', title: '今天的中文课程非常有趣' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'zh');
  });

  test('detects English from function words', async ({ page }) => {
    await setup(page, { selectedLanguage: 'en' }, [
      { id: 'v1', title: 'The most amazing things you will ever see' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'en');
  });

  test('detects Spanish from function words', async ({ page }) => {
    await setup(page, { selectedLanguage: 'es' }, [
      { id: 'v1', title: 'Los mejores momentos del partido de esta temporada' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'es');
  });

  test('detects French from function words', async ({ page }) => {
    await setup(page, { selectedLanguage: 'fr' }, [
      { id: 'v1', title: 'Les plus beaux endroits dans le monde avec nous' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'fr');
  });

  test('detects Chinese in mixed CJK/Latin title', async ({ page }) => {
    await setup(page, { selectedLanguage: 'zh' }, [
      { id: 'v1', title: 'NBA季后赛精彩时刻集锦' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'zh');
  });

  test('returns unknown for Japanese title', async ({ page }) => {
    await setup(page, { selectedLanguage: 'en', showUnknown: true }, [
      { id: 'v1', title: '日本語の勉強は楽しいです' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'unknown');
  });

  test('returns unknown for Korean title', async ({ page }) => {
    await setup(page, { selectedLanguage: 'en', showUnknown: true }, [
      { id: 'v1', title: '한국어 배우기 초급 강좌' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'unknown');
  });

  test('returns unknown for short/ambiguous title', async ({ page }) => {
    await setup(page, { selectedLanguage: 'en', showUnknown: true }, [
      { id: 'v1', title: 'Vlog 2024' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'unknown');
  });

  test('detects Mandarin-learning keywords in short titles', async ({ page }) => {
    await setup(page, { selectedLanguage: 'zh', showUnknown: true }, [
      { id: 'v1', title: 'Learn Chinese Mandarin' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'zh');
  });

  test('handles accented Spanish correctly', async ({ page }) => {
    await setup(page, { selectedLanguage: 'es' }, [
      { id: 'v1', title: 'Los más grandes momentos del fútbol en esta temporada' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'es');
  });

  test('detects Mandarin-learning titles written in Latin script', async ({ page }) => {
    await setup(page, { selectedLanguage: 'zh' }, [
      { id: 'v1', title: 'Why you understand MY CHINESE - Chinese Comprehensible Input' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'zh');
  });

  test('detects Spanish short titles with clear markers', async ({ page }) => {
    await setup(page, { selectedLanguage: 'es' }, [
      { id: 'v1', title: 'Nickzzy - La Para (Video Oficial) #SPANISHDRILL' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'es');
  });

  test('detects French mixed titles with short French phrases', async ({ page }) => {
    await setup(page, { selectedLanguage: 'fr' }, [
      { id: 'v1', title: 'LE TITAN DU TEMPS | Game of Roles Sheol #11' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'fr');
  });

  test('detects Chinese when CJK is mixed with Latin script', async ({ page }) => {
    await setup(page, { selectedLanguage: 'zh' }, [
      { id: 'v1', title: '溫蒂漫步 Wendy Wander - Spring Spring (Full Album)' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'zh');
  });

  test('detects language from mix aria-label when title text is generic', async ({ page }) => {
    await setup(
      page,
      { selectedLanguage: 'es' },
      [],
      {
        html: mixEl('mix1', 'Mix - BAD BUNNY - YO PERREO SOLA | YHLQMDLG (Video Oficial)')
      }
    );
    await expect(el(page, 'mix1')).toBeVisible();
    await expect(el(page, 'mix1')).toHaveAttribute(ATTR, 'es');
  });

  test('detects French from long mixed-case title with numbers', async ({ page }) => {
    await setup(page, { selectedLanguage: 'fr' }, [
      { id: 'v1', title: "3 semaines pour acheter des consoles dans le PIRE état au Japon" }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'fr');
  });

  test('detects Spanish from accented GTA title', async ({ page }) => {
    await setup(page, { selectedLanguage: 'es' }, [
      { id: 'v1', title: "Cómo GTA San Andreas rompió la PS2 para funcionar" }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'es');
  });

  test('detects French game-of-roles phrasing', async ({ page }) => {
    await setup(page, { selectedLanguage: 'fr' }, [
      { id: 'v1', title: "Game of Roles Saison 1 Episode 1 : Le début d'une grande aventure" }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'fr');
  });

  test('does not misclassify English title containing episode as French', async ({ page }) => {
    await setup(page, { selectedLanguage: 'fr', showUnknown: true }, [
      { id: 'v1', title: 'Every Seinfeld Episode Based On A True Story' }
    ]);
    await expect(el(page, 'v1')).toBeHidden();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'en');
  });

  test('does not classify generic English episode title as French', async ({ page }) => {
    await setup(page, { selectedLanguage: 'fr', showUnknown: true }, [
      { id: 'v1', title: 'FULL EPISODE | Season 22 Episode 1 | Mock The Week' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'unknown');
  });

  test('does not classify English title about Chinese topic as Chinese language', async ({ page }) => {
    await setup(page, { selectedLanguage: 'zh', showUnknown: true }, [
      { id: 'v1', title: "The Strange Reason Chinese Doesn't Borrow Words" }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'unknown');
  });

  test('detects French learning content from keyword + context', async ({ page }) => {
    await setup(page, { selectedLanguage: 'fr' }, [
      { id: 'v1', title: 'E01 Learning French Naturally' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'fr');
  });

  test('detects French comprehensible input content', async ({ page }) => {
    await setup(page, { selectedLanguage: 'fr' }, [
      { id: 'v1', title: 'French Comprehensible Input' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'fr');
  });

  test('detects Spanish learning content from keyword + context', async ({ page }) => {
    await setup(page, { selectedLanguage: 'es' }, [
      { id: 'v1', title: 'Learn Spanish Grammar and Vocabulary' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'es');
  });

  test('does not classify English title about French people as French', async ({ page }) => {
    await setup(page, { selectedLanguage: 'fr', showUnknown: true }, [
      { id: 'v1', title: 'Why Do the French Criticize Parisians' }
    ]);
    await expect(el(page, 'v1')).toBeHidden();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'en');
  });

  test('does not classify English title about Spanish history as Spanish', async ({ page }) => {
    await setup(page, { selectedLanguage: 'es', showUnknown: true }, [
      { id: 'v1', title: 'The Spanish Civil War Documentary' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'unknown');
  });

  test('detects espanol as strong Spanish keyword', async ({ page }) => {
    await setup(page, { selectedLanguage: 'es' }, [
      { id: 'v1', title: 'Tutorial de Photoshop en Espanol' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'es');
  });

  test('detects francais as strong French keyword', async ({ page }) => {
    await setup(page, { selectedLanguage: 'fr' }, [
      { id: 'v1', title: 'Podcast en Francais' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'fr');
  });

  test('detects French from sorti keyword with function word', async ({ page }) => {
    await setup(page, { selectedLanguage: 'fr' }, [
      { id: 'v1', title: 'Call of Duty a sorti un BANGER' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v1')).toHaveAttribute(ATTR, 'fr');
  });
});

// ---------------------------------------------------------------------------
// Filtering behavior tests
// ---------------------------------------------------------------------------

test.describe('filtering', () => {
  test('hides non-matching language when filtering for Chinese', async ({ page }) => {
    await setup(page, { selectedLanguage: 'zh', showUnknown: true }, [
      { id: 'zh1', title: '今天学习中文语法和词汇' },
      { id: 'en1', title: 'The most amazing things you will ever see in life' }
    ]);
    await expect(el(page, 'zh1')).toBeVisible();
    await expect(el(page, 'en1')).toBeHidden();
  });

  test('hides non-matching language when filtering for English', async ({ page }) => {
    await setup(page, { selectedLanguage: 'en', showUnknown: true }, [
      { id: 'en1', title: 'This is how you can do it by yourself' },
      { id: 'zh1', title: '今天学习中文语法和词汇' }
    ]);
    await expect(el(page, 'en1')).toBeVisible();
    await expect(el(page, 'zh1')).toBeHidden();
  });

  test('supports selecting multiple languages', async ({ page }) => {
    await setup(page, { selectedLanguages: ['en', 'es'], selectedLanguage: 'en', showUnknown: false }, [
      { id: 'en1', title: 'This is how you can do it by yourself' },
      { id: 'es1', title: 'Los mejores momentos del partido de esta temporada' },
      { id: 'fr1', title: 'Les plus beaux endroits dans le monde avec nous' }
    ]);
    await expect(el(page, 'en1')).toBeVisible();
    await expect(el(page, 'es1')).toBeVisible();
    await expect(el(page, 'fr1')).toBeHidden();
  });

  test('shows unknown titles when showUnknown is true', async ({ page }) => {
    await setup(page, { selectedLanguage: 'en', showUnknown: true }, [
      { id: 'v1', title: 'Parkour 2024' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
  });

  test('hides unknown titles when showUnknown is false', async ({ page }) => {
    await setup(page, { selectedLanguage: 'en', showUnknown: false }, [
      { id: 'v1', title: 'Parkour 2024' }
    ]);
    await expect(el(page, 'v1')).toBeHidden();
  });

  test('does nothing when disabled', async ({ page }) => {
    await setup(page, { enabled: false }, [
      { id: 'v1', title: '今天学习中文语法和词汇' },
      { id: 'v2', title: 'The most amazing things you will ever see in life' }
    ], { waitForAttr: false });

    await page.waitForTimeout(800);

    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v2')).toBeVisible();
  });

  test('keeps ambiguous learner titles visible when filtering for Chinese', async ({ page }) => {
    await setup(page, { selectedLanguage: 'zh', showUnknown: true }, [
      { id: 'v1', title: 'Chinese Vocabulary HSK Level' },
      { id: 'v2', title: '初级汉语听力训练课程' }
    ]);
    await expect(el(page, 'v1')).toBeVisible();
    await expect(el(page, 'v2')).toBeVisible();
  });
});
