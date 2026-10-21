import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const layout = read("../src/templates/layout.html");
const script = read("../src/js/theme.js");
const css = read("../src/css/theme.css");
const mainCss = read("../src/css/main.css");
const bootstrap = layout.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
const storageKey = "imsel-tools-theme";
let passed = 0;

function test(name, check) {
  check();
  passed++;
  console.log(`OK: ${name}`);
}

function page({ storage = new Map(), denyGet = false, denySet = false, denyAccess = false, selectExists = true } = {}) {
  const listeners = new Map();
  const root = { dataset: {} };
  const select = {
    value: "system",
    addEventListener: (name, callback) => listeners.set(name, callback),
  };
  const context = vm.createContext({
    document: {
      documentElement: root,
      getElementById: id => id === "theme-select" && selectExists ? select : null,
    },
  });
  Object.defineProperty(context, "localStorage", {
    get() {
      if (denyAccess) throw new Error("Storage access denied");
      return {
        getItem(key) {
          if (denyGet) throw new Error("Storage read denied");
          return storage.get(key) ?? null;
        },
        setItem(key, value) {
          if (denySet) throw new Error("Storage write denied");
          storage.set(key, value);
        },
      };
    },
  });
  vm.runInContext(bootstrap, context);
  const earlyTheme = root.dataset.theme;
  vm.runInContext(script, context);
  return {
    root, select, earlyTheme, storage,
    change(value) {
      select.value = value;
      listeners.get("change")();
    },
  };
}

test("bootstrap precedes all styles and module, theme stylesheet follows main", () => {
  assert.ok(bootstrap);
  const early = layout.indexOf("<script>");
  const styles = layout.indexOf('<link rel="stylesheet"');
  assert.ok(early < styles);
  assert.ok(layout.indexOf("main.css") < layout.indexOf("theme.css"));
  assert.ok(layout.indexOf("theme.css") < layout.indexOf('type="module"'));
  assert.match(layout, /type="module" src="\$ROOT\$\/assets\/js\/theme\.js"/);
});

test("selector has accessible translated label and all three options", () => {
  assert.match(layout, /<label class="theme-control" for="theme-select">/);
  assert.match(layout, /<select id="theme-select">/);
  for (const key of ["themeLabel", "themeSystem", "themeLight", "themeDark"]) {
    assert.ok(layout.includes(`{{t:common.${key}}}`));
  }
  for (const value of ["system", "light", "dark"]) {
    assert.ok(layout.includes(`<option value="${value}">`));
  }
});

test("missing preference defaults to system without writing storage", () => {
  const current = page();
  assert.equal(current.earlyTheme, "system");
  assert.equal(current.select.value, "system");
  assert.equal(current.storage.size, 0);
});

test("saved choices apply before module initialization", () => {
  for (const theme of ["system", "light", "dark"]) {
    const current = page({ storage: new Map([[storageKey, theme]]) });
    assert.equal(current.earlyTheme, theme);
    assert.equal(current.select.value, theme);
  }
});

test("choices persist across reloads and pages", () => {
  const storage = new Map([["other-setting", "untouched"]]);
  let current = page({ storage });
  for (const theme of ["dark", "light", "system"]) {
    current.change(theme);
    assert.equal(current.root.dataset.theme, theme);
    assert.equal(storage.get(storageKey), theme);
    current = page({ storage });
    assert.equal(current.earlyTheme, theme);
    assert.equal(current.select.value, theme);
  }
  assert.equal(storage.get("other-setting"), "untouched");
});

test("invalid stored or selected values fall back to system", () => {
  for (const value of ["", "DARK", "unexpected", "null"]) {
    const current = page({ storage: new Map([[storageKey, value]]) });
    assert.equal(current.earlyTheme, "system");
    assert.equal(current.select.value, "system");
    current.change(value);
    assert.equal(current.root.dataset.theme, "system");
    assert.equal(current.select.value, "system");
    assert.equal(current.storage.get(storageKey), "system");
  }
});

test("blocked storage getter does not stop selection", () => {
  const current = page({ denyAccess: true });
  assert.equal(current.earlyTheme, "system");
  current.change("dark");
  assert.equal(current.root.dataset.theme, "dark");
});

test("blocked storage reads still allow current selection and persistence", () => {
  const current = page({ denyGet: true });
  assert.equal(current.earlyTheme, "system");
  current.change("light");
  assert.equal(current.root.dataset.theme, "light");
  assert.equal(current.storage.get(storageKey), "light");
});

test("blocked storage writes preserve current selection", () => {
  const current = page({ storage: new Map([[storageKey, "dark"]]), denySet: true });
  assert.equal(current.earlyTheme, "dark");
  current.change("light");
  assert.equal(current.root.dataset.theme, "light");
  assert.equal(current.select.value, "light");
  assert.equal(current.storage.get(storageKey), "dark");
});

test("missing control is harmless", () => {
  assert.equal(page({ selectExists: false }).earlyTheme, "system");
});

function declarations(body) {
  return Object.fromEntries([...body.matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);/g)]
    .map(([, name, value]) => [name, value.trim()]));
}

test("explicit palettes match main CSS and outrank system root variables", () => {
  const palettes = [...mainCss.matchAll(/:root\s*\{([^}]+)\}/g)]
    .slice(0, 2).map(([, body]) => declarations(body));
  for (const [index, theme] of ["dark", "light"].entries()) {
    const body = css.match(new RegExp(`html\\[data-theme="${theme}"\\]\\s*\\{([^}]+)\\}`))?.[1];
    assert.ok(body, "html + attribute outranks :root");
    const values = declarations(body);
    assert.equal(values["color-scheme"], theme);
    delete values["color-scheme"];
    assert.deepEqual(values, palettes[index]);
  }
});

test("system uses live media CSS without JavaScript system snapshots", () => {
  assert.match(css, /:root\s*\{\s*color-scheme:\s*dark;\s*\}/);
  assert.match(css, /@media\s*\(prefers-color-scheme:\s*light\)\s*\{\s*:root\s*\{\s*color-scheme:\s*light;/);
  assert.match(mainCss, /@media\s*\(prefers-color-scheme:\s*light\)\s*\{\s*:root/);
  assert.doesNotMatch(bootstrap + script, /matchMedia/);
  const current = page();
  current.change("dark");
  current.change("system");
  assert.equal(current.root.dataset.theme, "system");
  assert.doesNotMatch(css, /html\[data-theme="system"\]/);
});

console.log(`\n${passed} theme tests passed.`);
