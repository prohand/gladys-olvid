// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildActions } from '../src/actions.js';
import { DEFAULT_CONFIG, INTERNAL_CONFIG_KEYS } from '../src/config.js';
import {
  DAEMON_CONTAINER_NAME,
  DAEMON_TMP_DIR,
  MANAGED_DAEMON_URL,
} from '../src/olvid/container.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

test('the manifest declares a bidirectional communication channel', () => {
  assert.equal(manifest.type, 'communication');
  assert.equal(manifest.messaging.receive, true);
  // A bidirectional channel links by code: contact_schema is for send-only ones.
  assert.equal(manifest.contact_schema, undefined);
});

test('the manifest declares the cloud transport', () => {
  // Olvid messages travel through the Olvid servers: the store shows the
  // "Cloud" badge. A single transport renders no "prefer local" toggle.
  assert.deepEqual(manifest.transports, ['cloud']);
});

// The minimum Gladys version a `gladys_version` range accepts, as numbers
// (never compared as text: "5.10" > "5.3").
function minimumGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function floorAtLeast(major, minor) {
  const [floorMajor, floorMinor] = minimumGladysVersion();
  return floorMajor > major || (floorMajor === major && floorMinor >= minor);
}

// The store's controlled vocabulary of catalog shelves (2026-10).
const CATEGORY_VOCABULARY = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
  'transport',
  'vehicles',
  'servers',
  'leisure',
];

test('the catalog categories are 1 to 3 known shelves, and need Gladys >= 4.86.0', () => {
  // An unknown key is only dropped with a warning by the store, so a typo
  // would silently cost a shelf: the vocabulary is pinned here.
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.equal(new Set(manifest.categories).size, manifest.categories.length);
  for (const category of manifest.categories) {
    assert.ok(CATEGORY_VOCABULARY.includes(category), `unknown category "${category}"`);
  }
  // Older cores reject any unknown manifest field.
  assert.ok(floorAtLeast(4, 86), `categories requires gladys_version >= 4.86.0`);
});

test('the search keywords respect the store rules', () => {
  const { keywords } = manifest;
  assert.ok(Array.isArray(keywords) && keywords.length >= 1 && keywords.length <= 10);
  const normalized = keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, keywords.length, 'keywords must be unique');
  for (const keyword of normalized) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, `keyword "${keyword}" (2 to 30)`);
  }
});

test('Olvid works in every country: no countries restriction', () => {
  // `countries` hides the integration from the browse views of the other
  // countries: a messenger available worldwide must not declare it.
  assert.equal(manifest.countries, undefined);
});

test('keywords, countries and music need Gladys >= 5.3.0', () => {
  // The first core that accepts them: an older one rejects the whole manifest
  // over an unknown field, so the floor and the fields move together.
  if (['keywords', 'countries', 'music'].some((field) => field in manifest)) {
    assert.ok(
      floorAtLeast(5, 3),
      `keywords / countries / music require gladys_version >= 5.3.0, got "${manifest.gladys_version}"`,
    );
  }
});

test('every manifest action has a registered handler', () => {
  const handled = new Set(Object.keys(buildActions({ daemon: {} })));
  for (const action of manifest.actions ?? []) {
    assert.ok(handled.has(action.key), `manifest action "${action.key}" has no handler`);
  }
  for (const key of handled) {
    assert.ok(
      (manifest.actions ?? []).some((action) => action.key === key),
      `handler "${key}" is not declared in the manifest`,
    );
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
});

test('every config_schema field is known by the code', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      continue;
    }
    assert.ok(
      field.key in DEFAULT_CONFIG,
      `config field "${field.key}" is missing in DEFAULT_CONFIG`,
    );
  }
});

test('internal config keys are never rendered in the Configuration screen', () => {
  const declared = new Set(manifest.config_schema.map((field) => field.key));
  for (const key of INTERNAL_CONFIG_KEYS) {
    assert.ok(
      !declared.has(key),
      `"${key}" is internal storage and must stay out of config_schema`,
    );
    assert.ok(!(key in DEFAULT_CONFIG), `"${key}" is internal storage, not a user default`);
  }
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((field) => field.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(section.label?.en && section.label?.fr && section.label?.de && section.label?.es);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

// The languages of the Gladys interface: every text the user reads carries them all.
const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Every multi-language object of the manifest, wherever it sits (labels,
// descriptions, placeholders, option and link labels…), with its path.
function collectTexts(node, path = '', found = []) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectTexts(item, `${path}[${index}]`, found));
  } else if (node && typeof node === 'object') {
    if (typeof node.en === 'string') {
      found.push({ path, text: node });
      return found;
    }
    for (const [key, value] of Object.entries(node)) {
      collectTexts(value, path ? `${path}.${key}` : key, found);
    }
  }
  return found;
}

test('every user-facing text exists in every language of Gladys', () => {
  const texts = collectTexts(manifest);
  assert.ok(texts.length > 30, 'the walk should find the manifest texts');
  for (const { path, text } of texts) {
    for (const language of LANGUAGES) {
      assert.ok(
        typeof text[language] === 'string' && text[language].trim() !== '',
        `missing "${language}" text at ${path}`,
      );
    }
    assert.deepEqual(Object.keys(text), LANGUAGES, `unexpected languages at ${path}`);
  }
});

test('the texts respect the store length limits in every language', () => {
  for (const language of LANGUAGES) {
    const description = manifest.description[language];
    assert.ok(
      description.length >= 10 && description.length <= 100,
      `catalog description "${language}" holds ${description.length} characters (10 to 100)`,
    );
    for (const section of manifest.config_schema.filter((field) => field.type === 'section')) {
      assert.ok((section.description?.[language] ?? '').length <= 1000);
    }
  }
});

test('the manifest declares the Olvid daemon the code starts', () => {
  const [daemon, ...others] = manifest.containers;
  assert.equal(others.length, 0, 'a single sub-container is expected');
  // The name is the DNS alias on the private network: the URL the code uses to
  // reach the daemon is derived from it, so both must stay in sync.
  assert.equal(daemon.name, DAEMON_CONTAINER_NAME);
  assert.ok(MANAGED_DAEMON_URL.includes(`//${DAEMON_CONTAINER_NAME}:`));
  // The image must be pinned: "latest" would silently change the Olvid client
  // holding the user's identity.
  assert.match(daemon.docker_image, /^olvid\/bot-daemon:\d+\.\d+\.\d+$/);
  // The admin key is computed at runtime and passed to startContainer: it can
  // never appear in the manifest, which is public.
  for (const key of Object.keys(daemon.env ?? {})) {
    assert.ok(
      !key.startsWith('OLVID_ADMIN_CLIENT_KEY'),
      `"${key}" is a secret, not a manifest env`,
    );
  }
  // The JVM must write and EXECUTE its unpacked native libraries somewhere,
  // and /tmp is mounted noexec in the sandbox: the temporary folder declared
  // here is the one the integration prepares inside the data volume.
  assert.ok(daemon.env.JAVA_FLAGS.includes(`-Djava.io.tmpdir=${DAEMON_TMP_DIR}`));
  assert.ok(daemon.env.JAVA_FLAGS.includes(`-Dorg.sqlite.tmpdir=${DAEMON_TMP_DIR}`));
  // Started by the integration, precisely because of that key.
  assert.equal(daemon.start, 'manual');
  // The Olvid identity lives in those volumes: without them, every restart
  // would create a new profile and lose the contacts. `/daemon/backups` is
  // written by the daemon on its own, and holds a copy of that identity.
  assert.deepEqual(daemon.volumes, ['/daemon/data', '/daemon/backups']);
  // No published port: the gRPC API is admin-level, it stays on the private
  // network of the integration.
  assert.equal(daemon.ports, undefined);
});

test('the manifest version matches the docker image tag', () => {
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    'the docker_image tag must be the manifest version',
  );
});

test('the gRPC client and the daemon image move together', async () => {
  // @olvid/bot-node is generated from the daemon's own protobuf API: a client
  // and a daemon of different minor versions may disagree on a message or a
  // call. The client shipped is the one the lock file resolves, the daemon the
  // one the manifest pins — Dependabot bumps only the first.
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const majorMinor = (version) =>
    version
      .replace(/^[^\d]*/, '')
      .split('.')
      .slice(0, 2)
      .join('.');

  const imageTag = manifest.containers[0].docker_image.split(':')[1];
  const declared = pkg.dependencies['@olvid/bot-node'];
  const installed = lock.packages['node_modules/@olvid/bot-node'].version;
  assert.equal(majorMinor(declared), majorMinor(imageTag), `package.json ${declared}`);
  assert.equal(majorMinor(installed), majorMinor(imageTag), `package-lock.json ${installed}`);
});
