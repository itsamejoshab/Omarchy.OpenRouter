// Price-tape seam: decide(payload, state, now, outcome) → { status, rows, state }.
// Loads Model.js by skipping the QML pragma line. No package manifest.

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";

const source = readFileSync(new URL("./Model.js", import.meta.url), "utf8");
const body = source.replace(/^\.pragma library\r?\n/, "");
const context = vm.createContext({ console });
vm.runInContext(body, context, { filename: "Model.js" });

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

// Nothing loaded yet: four sample cells, not an error, and no day written.
test("pending with no payload and no saved state shows four sample quotes and no day", () => {
  const now = Date.UTC(2026, 9, 29, 16, 0, 0);
  const result = typeof context.decide === "function"
    ? context.decide(null, null, now, "pending")
    : undefined;

  assert.ok(result && typeof result === "object", "decide(null, null, now, pending) returned no result");
  assert.equal(result.status, "empty");
  assert.ok(Array.isArray(result.rows));
  assert.equal(result.rows.length, 4);

  for (const row of result.rows) {
    assert.equal(row.id ?? "", "");
    assert.equal(row.ticker, "XXXXX");
    assert.equal(row.price, "$0.00");
    assert.equal(`${row.ticker} ${row.price}`, "XXXXX $0.00");
    assert.equal(String(row.ticker).includes("unavailable"), false);
    assert.equal(String(row.price).includes("unavailable"), false);
  }

  const days = result.state && typeof result.state === "object" ? result.state.days : null;
  assert.ok(days == null || (typeof days === "object" && Object.keys(days).length === 0));
});

const NOW = Date.UTC(2026, 9, 29, 16, 0, 0);

function call(payload, state, outcome, now = NOW) {
  assert.equal(typeof context.decide, "function");
  const result = context.decide(payload, state, now, outcome);
  assert.ok(result && typeof result === "object");
  // decide runs in a vm realm. Compare the JSON document callers persist,
  // not the foreign array prototype.
  return JSON.parse(JSON.stringify(result));
}

function model(id, prompt, completion, extra) {
  return Object.assign({ id, pricing: { prompt, completion } }, extra || {});
}

function dayRecord(state) {
  if (!state || typeof state !== "object" || state.days == null) return null;
  return state.days;
}

test("worked tickers are SONNT, GPT4O, and OPUS", () => {
  const cases = [
    ["anthropic/claude-sonnet", "SONNT"],
    ["openai/gpt-4o", "GPT4O"],
    ["anthropic/claude-opus-5.5", "OPUS"],
  ];
  for (const [id, ticker] of cases) {
    const result = call([model(id, "0.000002", "0.000006")], null, "ok");
    assert.equal(result.status, "rows");
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].id, id);
    assert.equal(result.rows[0].ticker, ticker);
    assert.equal(result.rows[0].arrow, "none");
  }
});

test("date, preview, latest, and version tokens are removed and 4o stays", () => {
  const cases = [
    ["openai/gpt-4o-0613", "GPT4O"],
    ["openai/gpt-4o-preview", "GPT4O"],
    ["openai/gpt-4o-latest", "GPT4O"],
    ["openai/gpt-4o-v4.1", "GPT4O"],
    ["openai/gpt-4o:free", "GPT4O"],
    ["audiofile", "AUDFL"],
    ["acme/bcdfgh", "BCDFG"],
    ["deepseek/deepseek-chat", "CHAT"],
    ["minimax/minimax-text", "TEXT"],
    ["acme/v4.1", "V41"],
  ];
  for (const [id, ticker] of cases) {
    const result = call([model(id, "1", "1")], null, "ok");
    assert.equal(result.status, "rows");
    assert.equal(result.rows[0].ticker, ticker, id);
  }
});

test("an earlier model keeps the base ticker and a :free twin is disambiguated", () => {
  const result = call([
    model("anthropic/claude-sonnet", "0.000002", "0.000006"),
    model("anthropic/claude-sonnet:free", "0.000002", "0.000006"),
  ], null, "ok");
  assert.equal(result.status, "rows");
  assert.deepEqual(result.rows.map((row) => row.id), [
    "anthropic/claude-sonnet",
    "anthropic/claude-sonnet:free",
  ]);
  assert.deepEqual(result.rows.map((row) => row.ticker), ["SONNT", "ANNET"]);
  assert.deepEqual(result.rows.map((row) => row.arrow), ["none", "none"]);
});

test("a collided ticker grows to seven characters, then a digit, and is omitted after 9", () => {
  const ids = [
    "anthropic/claude-sonnet",
    "aa/onnet",
    "other/claude-sonnet",
    "openai/claude-sonnet",
    "oa/claude-sonnet",
    "ob/claude-sonnet",
    "oc/claude-sonnet",
    "od/claude-sonnet",
    "oe/claude-sonnet",
    "of/claude-sonnet",
    "og/claude-sonnet",
    "oh/claude-sonnet",
    "oi/claude-sonnet",
  ];
  const result = call(ids.map((id) => model(id, "0.000002", "0.000006")), null, "ok");
  assert.equal(result.status, "rows");
  assert.deepEqual(result.rows.map((row) => [row.id, row.ticker]), [
    ["anthropic/claude-sonnet", "SONNT"],
    ["aa/onnet", "ONNET"],
    ["other/claude-sonnet", "OONNET"],
    ["openai/claude-sonnet", "OSONNET"],
    ["oa/claude-sonnet", "OSONNE2"],
    ["ob/claude-sonnet", "OSONNE3"],
    ["oc/claude-sonnet", "OSONNE4"],
    ["od/claude-sonnet", "OSONNE5"],
    ["oe/claude-sonnet", "OSONNE6"],
    ["of/claude-sonnet", "OSONNE7"],
    ["og/claude-sonnet", "OSONNE8"],
    ["oh/claude-sonnet", "OSONNE9"],
  ]);
  assert.equal(result.rows.some((row) => row.id === "oi/claude-sonnet"), false);
  assert.ok(Array.isArray(result.state.live));
  assert.deepEqual(result.state.live.map((entry) => entry.id), ids);
  assert.deepEqual(result.state.live.map((entry) => entry.ticker ?? null), [
    "SONNT", "ONNET", "OONNET", "OSONNET",
    "OSONNE2", "OSONNE3", "OSONNE4", "OSONNE5",
    "OSONNE6", "OSONNE7", "OSONNE8", "OSONNE9",
    null,
  ]);
  const omitted = result.state.live.find((entry) => entry.id === "oi/claude-sonnet");
  assert.ok(omitted, "omitted model stays on the live qualifying list");
  assert.equal(omitted.ticker ?? null, null);
  assert.equal(omitted.blend, 3000);
  for (const row of result.rows) assert.equal(row.arrow, "none");
});

test("aliases and unparsable or negative prices are omitted, and an empty alias stays", () => {
  const result = call([
    model("openai/gpt-4o", "0.000002", "0.000006", { alias_target: "" }),
    model("alias/string", "0.000002", "0.000006", { alias_target: "openai/gpt-4o" }),
    model("alias/object", "0.000002", "0.000006", {
      alias_target: { name: "Claude Sonnet", slug: "anthropic/claude-sonnet" },
    }),
    model("anthropic/claude-opus-5.5", "0.000002", "0.000006", { alias_target: null }),
    model("priced/negative", "-0.000002", "0.000006"),
    model("priced/neg-out", "1", "-1"),
    model("priced/null", null, "1"),
    model("priced/null-out", "1", null),
    model("priced/blank", "", "1"),
    model("priced/object", { usd: 1 }, "1"),
    model("priced/partial", "1abc", "1"),
    model("priced/partial-out", "1", "1abc"),
    model("priced/exponent", "1e-6", "1"),
    model("anthropic/claude-sonnet", "0", "0"),
  ], null, "ok");
  assert.equal(result.status, "rows");
  assert.deepEqual(result.rows.map((row) => row.id), [
    "openai/gpt-4o",
    "anthropic/claude-opus-5.5",
    "anthropic/claude-sonnet",
  ]);
  assert.deepEqual(result.rows.map((row) => row.ticker), ["GPT4O", "OPUS", "SONNT"]);
  assert.equal(result.rows[2].price, "$0.00");
  assert.equal(result.rows[2].hover, "in $0.00 · out $0.00 per million");
});

test("blend display uses thousands separators, four decimals under one cent, and half away from zero", () => {
  // 0.000002 * 1e9 = 2000 and 0.000006 * 1e9 = 6000. Three parts input to one
  // part output is 3000 per billion, which reads $3,000.00.
  const thousands = call([model("openai/gpt-4o", "0.000002", "0.000006")], null, "ok");
  assert.equal(thousands.rows[0].price, "$3,000.00");
  assert.equal(thousands.rows[0].price.includes("/"), false);
  assert.equal(thousands.state.live[0].blend, 3000);
  assert.equal(thousands.state.live[0].prompt, 2);
  assert.equal(thousands.state.live[0].completion, 6);
  assert.equal(thousands.state.live[0].ticker, "GPT4O");
  assert.equal(thousands.state.live[0].price, "$3,000.00");

  // Both sides are 0.001 per billion. The blend is 0.001, shown to four decimals.
  const tiny = call([model("lab/tiny", "0.000000000001", "0.000000000001")], null, "ok");
  assert.equal(tiny.rows[0].price, "$0.0010");
  assert.equal(tiny.state.live[0].blend, 0.001);

  // 1.005 per billion is the halfway case. Half away from zero is $1.01,
  // checked by hand (the third decimal is 5).
  const half = call([model("lab/half", "0.000000001005", "0.000000001005")], null, "ok");
  assert.equal(half.rows[0].price, "$1.01");
  assert.equal(half.state.live[0].blend, 1.005);
});

test("hover is the listing prices per million and the model id is the other line", () => {
  const result = call([model("anthropic/claude-sonnet", "0.00000014", "0.00000042")], null, "ok");
  assert.equal(result.rows[0].id, "anthropic/claude-sonnet");
  assert.equal(result.rows[0].hover, "in $0.14 · out $0.42 per million");
  assert.equal(result.rows[0].price, "$210.00");
  assert.equal(result.rows[0].arrow, "none");
  assert.equal(result.state.live[0].prompt, 0.14);
  assert.equal(result.state.live[0].completion, 0.42);
  assert.equal(result.state.live[0].blend, 210);

  const fine = call([model("lab/fine", "0.000000005", "0")], null, "ok");
  assert.equal(fine.rows[0].hover, "in $0.0050 · out $0.00 per million");
  assert.equal(fine.rows[0].hover.includes("blend"), false);
  assert.equal(fine.rows[0].hover.includes("3:1"), false);
});

test("one, two, or three qualifying models are not padded to four rows", () => {
  const one = call([model("openai/gpt-4o", "0", "0")], null, "ok");
  assert.equal(one.status, "rows");
  assert.equal(one.rows.length, 1);

  const two = call([
    model("openai/gpt-4o", "0", "0"),
    model("anthropic/claude-opus-5.5", "0", "0"),
  ], null, "ok");
  assert.equal(two.rows.length, 2);
  assert.deepEqual(two.rows.map((row) => row.ticker), ["GPT4O", "OPUS"]);

  const three = call([
    model("openai/gpt-4o", "0", "0"),
    model("anthropic/claude-opus-5.5", "0", "0"),
    model("anthropic/claude-sonnet", "0", "0"),
  ], null, "ok");
  assert.equal(three.rows.length, 3);
});

test("pending or error with live repaints those quotes, and error without live is unavailable", () => {
  const ok = call([model("anthropic/claude-sonnet", "0.00000014", "0.00000042")], null, "ok");
  assert.equal(ok.status, "rows");

  for (const outcome of ["pending", "error"]) {
    const saved = JSON.parse(JSON.stringify(ok.state));
    const again = call(null, saved, outcome);
    assert.equal(again.status, "rows");
    assert.equal(again.rows.length, 1);
    assert.equal(again.rows[0].id, "anthropic/claude-sonnet");
    assert.equal(again.rows[0].ticker, "SONNT");
    assert.equal(again.rows[0].price, "$210.00");
    assert.equal(again.rows[0].hover, "in $0.14 · out $0.42 per million");
    assert.equal(again.rows[0].arrow, "none");
    assert.equal(again.state.live[0].blend, 210);
  }

  const failed = call(null, null, "error");
  assert.equal(failed.status, "unavailable");
  assert.equal(failed.rows.length, 0);
  assert.equal(dayRecord(failed.state), null);
});

test("an ok with nothing qualifying is unavailable, clears live, and keeps older days", () => {
  const older = {
    "2026-10-01": {
      "keep/me": { blend: 1, prompt: 1, completion: 1 },
    },
  };
  const seeded = call([model("openai/gpt-4o", "0.000002", "0.000006")], { days: older, live: null }, "ok");
  assert.equal(seeded.status, "rows");

  const savedSeed = JSON.parse(JSON.stringify(seeded.state));
  const cleared = call([
    model("alias/object", "1", "1", {
      alias_target: { name: "Claude Sonnet", slug: "anthropic/claude-sonnet" },
    }),
  ], savedSeed, "ok");
  assert.equal(cleared.status, "unavailable");
  assert.equal(cleared.rows.length, 0);
  assert.equal(cleared.state.live, null);
  assert.deepEqual(cleared.state.days, savedSeed.days);
  assert.deepEqual(cleared.state.days["2026-10-01"], older["2026-10-01"]);

  const fresh = call([model("priced/negative", "-1", "1")], null, "ok");
  assert.equal(fresh.status, "unavailable");
  assert.equal(fresh.state.live, null);
  assert.equal(dayRecord(fresh.state), null);
});

test("the first ok of a UTC day stores every qualifying model, including one left off the tape", () => {
  const ids = [
    "anthropic/claude-sonnet",
    "aa/onnet",
    "other/claude-sonnet",
    "openai/claude-sonnet",
    "oa/claude-sonnet",
    "ob/claude-sonnet",
    "oc/claude-sonnet",
    "od/claude-sonnet",
    "oe/claude-sonnet",
    "of/claude-sonnet",
    "og/claude-sonnet",
    "oh/claude-sonnet",
    "oi/claude-sonnet",
  ];
  const result = call(ids.map((id) => model(id, "0.000002", "0.000006")).concat([
    model("priced/negative", "-1", "1"),
  ]), null, "ok", NOW);
  assert.equal(result.status, "rows");
  assert.equal(result.rows.length, ids.length - 1);
  assert.equal(result.rows.some((row) => row.id === "oi/claude-sonnet"), false);
  assert.ok(result.state.days && result.state.days["2026-10-29"], "2026-10-29 was not saved");
  const day = result.state.days["2026-10-29"];
  for (const id of ids) {
    assert.equal(day[id].blend, 3000, id);
    assert.equal(day[id].prompt, 2, id);
    assert.equal(day[id].completion, 6, id);
  }
  assert.equal(day["priced/negative"], undefined);
  assert.equal(result.rows[0].arrow, "none");

  // 1.2345 per billion is not a display rounding boundary. The day keeps it whole.
  const fractional = call([model("lab/frac", "0.0000000012345", "0.0000000012345")], null, "ok", NOW);
  assert.equal(fractional.rows[0].price, "$1.23");
  assert.equal(fractional.state.days["2026-10-29"]["lab/frac"].blend, 1.2345);
  assert.equal(fractional.state.days["2026-10-29"]["lab/frac"].prompt, 0.0012345);
  assert.equal(fractional.state.days["2026-10-29"]["lab/frac"].completion, 0.0012345);
});

test("a later ok the same UTC day repaints live and leaves the morning blend frozen", () => {
  const first = call([model("openai/gpt-4o", "0.000002", "0.000006")], null, "ok", NOW);
  assert.equal(first.rows[0].price, "$3,000.00");
  assert.ok(first.state.days && first.state.days["2026-10-29"], "2026-10-29 was not saved");
  assert.equal(first.state.days["2026-10-29"]["openai/gpt-4o"].blend, 3000);
  assert.equal(first.state.days["2026-10-29"]["openai/gpt-4o"].prompt, 2);
  assert.equal(first.state.days["2026-10-29"]["openai/gpt-4o"].completion, 6);

  const second = call([
    model("openai/gpt-4o", "0.00000014", "0.00000042"),
    model("lab/late", "0.000000001", "0.000000001"),
  ], first.state, "ok", NOW);
  assert.equal(second.rows[0].price, "$210.00");
  assert.equal(second.rows[0].arrow, "none");
  assert.equal(second.rows[1].id, "lab/late");
  assert.equal(second.rows[1].price, "$1.00");
  assert.equal(second.state.live[0].blend, 210);
  assert.equal(second.state.days["2026-10-29"]["openai/gpt-4o"].blend, 3000);
  assert.equal(second.state.days["2026-10-29"]["lab/late"], undefined);
  assert.equal(second.state.days["2026-10-29"]["openai/gpt-4o"].prompt, 2);
  assert.equal(second.state.days["2026-10-29"]["openai/gpt-4o"].completion, 6);

  const restarted = call(null, second.state, "pending", NOW);
  assert.equal(restarted.status, "rows");
  assert.equal(restarted.rows[0].price, "$210.00");
  assert.equal(restarted.rows[0].ticker, "GPT4O");
});

test("arrows follow the rounded price against the latest earlier day that has the model", () => {
  // 1.004 rounds to $1.00 (the third decimal is 4). A live blend of 1 is also $1.00.
  const flat = call([model("lab/flat", "0.000000001", "0.000000001")], {
    days: { "2026-10-28": { "lab/flat": { blend: 1.004, prompt: 1.004, completion: 1.004 } } },
    live: null,
  }, "ok", NOW);
  assert.equal(flat.rows[0].price, "$1.00");
  assert.equal(flat.rows[0].arrow, "none");

  const rise = call([model("lab/rise", "0.000000002", "0.000000002")], {
    days: { "2026-10-28": { "lab/rise": { blend: 1, prompt: 1, completion: 1 } } },
    live: null,
  }, "ok", NOW);
  assert.equal(rise.rows[0].price, "$2.00");
  assert.equal(rise.rows[0].arrow, "up");

  const fall = call([model("openai/gpt-4o", "0.00000014", "0.00000042")], {
    days: { "2026-10-28": { "openai/gpt-4o": { blend: 3000, prompt: 2, completion: 6 } } },
    live: null,
  }, "ok", NOW);
  assert.equal(fall.rows[0].price, "$210.00");
  assert.equal(fall.rows[0].arrow, "down");

  // Keys are not in date order. 2026-10-20 ($5.00) is the latest day with this
  // model. 2026-10-01 ($9.00) is older. 2026-10-27 does not have it. Live $7.00
  // rises against $5.00 and would fall against $9.00.
  const gapped = call([model("lab/gap", "0.000000007", "0.000000007")], {
    days: {
      "2026-10-20": { "lab/gap": { blend: 5, prompt: 5, completion: 5 } },
      "2026-10-27": { "other/model": { blend: 1, prompt: 1, completion: 1 } },
      "2026-10-01": { "lab/gap": { blend: 9, prompt: 9, completion: 9 } },
    },
    live: null,
  }, "ok", NOW);
  assert.equal(gapped.rows[0].price, "$7.00");
  assert.equal(gapped.rows[0].arrow, "up");

  const missing = call([model("lab/new", "0.000000001", "0.000000001")], {
    days: { "2026-10-28": { "other/model": { blend: 4, prompt: 4, completion: 4 } } },
    live: null,
  }, "ok", NOW);
  assert.equal(missing.rows[0].arrow, "none");
});

test("days older than 30 calendar days drop on load and on write, and a backward clock does not rewrite a newer day", () => {
  const seed = call([model("openai/gpt-4o", "0.000002", "0.000006")], null, "ok", NOW);
  const aged = {
    days: {
      "2026-09-28": { "old/model": { blend: 1, prompt: 1, completion: 1 } },
      "2026-09-29": { "keep/edge": { blend: 2, prompt: 2, completion: 2 } },
      "2026-10-01": { "keep/recent": { blend: 3, prompt: 3, completion: 3 } },
    },
    live: seed.state.live,
  };
  const loaded = call(null, aged, "pending", NOW);
  assert.equal(loaded.state.days["2026-09-28"], undefined);
  assert.equal(loaded.state.days["2026-09-29"]["keep/edge"].blend, 2);
  assert.equal(loaded.state.days["2026-10-01"]["keep/recent"].blend, 3);
  assert.equal(loaded.rows[0].price, "$3,000.00");

  const written = call([model("openai/gpt-4o", "0.000002", "0.000006")], aged, "ok", NOW);
  assert.equal(written.state.days["2026-09-28"], undefined);
  assert.equal(written.state.days["2026-09-29"]["keep/edge"].blend, 2);
  assert.equal(written.state.days["2026-10-29"]["openai/gpt-4o"].blend, 3000);

  const backward = call(
    [model("openai/gpt-4o", "0.00000014", "0.00000042")],
    {
      days: { "2026-10-29": { "openai/gpt-4o": { blend: 3000, prompt: 2, completion: 6 } } },
      live: null,
    },
    "ok",
    Date.UTC(2026, 9, 28, 12, 0, 0),
  );
  assert.deepEqual(Object.keys(backward.state.days), ["2026-10-29"]);
  assert.equal(backward.state.days["2026-10-29"]["openai/gpt-4o"].blend, 3000);
  assert.equal(backward.state.days["2026-10-29"]["openai/gpt-4o"].prompt, 2);
  assert.equal(backward.rows[0].price, "$210.00");
  assert.equal(backward.state.live[0].blend, 210);
  assert.equal(backward.rows[0].arrow, "none");
  const replayed = call(null, backward.state, "pending", Date.UTC(2026, 9, 28, 12, 0, 0));
  assert.equal(replayed.rows[0].price, "$210.00");
});

test("a restart paints the saved live price and the arrow against an earlier day", () => {
  const state = {
    days: {
      "2026-10-28": { "openai/gpt-4o": { blend: 3000, prompt: 2, completion: 6 } },
    },
    live: [{
      id: "openai/gpt-4o",
      blend: 210,
      prompt: 0.14,
      completion: 0.42,
      ticker: "GPT4O",
      price: "$210.00",
      hover: "in $0.14 · out $0.42 per million",
    }],
  };
  const pending = call(null, state, "pending", NOW);
  assert.equal(pending.status, "rows");
  assert.equal(pending.rows[0].ticker, "GPT4O");
  assert.equal(pending.rows[0].price, "$210.00");
  assert.equal(pending.rows[0].arrow, "down");
  assert.equal(pending.state.days["2026-10-28"]["openai/gpt-4o"].blend, 3000);

  const failed = call(null, state, "error", NOW);
  assert.equal(failed.status, "rows");
  assert.equal(failed.rows[0].price, "$210.00");
  assert.equal(failed.rows[0].arrow, "down");
});

test("a wrong-shaped history is no history and does not block a new day", () => {
  const empty = call(null, { days: [], live: {} }, "pending", NOW);
  assert.equal(empty.status, "empty");
  assert.equal(empty.rows.length, 4);
  assert.equal(empty.rows[0].ticker, "XXXXX");
  assert.equal(empty.state.days, null);

  const junk = call(null, {
    days: {
      zzz: { "openai/gpt-4o": { blend: 1, prompt: 1, completion: 1 } },
      "9999-99-99": { "openai/gpt-4o": { blend: 9, prompt: 9, completion: 9 } },
    },
    live: [{ ticker: "X" }],
  }, "pending", NOW);
  assert.equal(junk.status, "empty");
  assert.equal(junk.rows[0].ticker, "XXXXX");
  assert.equal(junk.state.days, null);
  assert.equal(junk.state.live, null);

  const recovered = call([model("openai/gpt-4o", "0.000002", "0.000006")], {
    days: { zzz: { "openai/gpt-4o": { blend: 1, prompt: 1, completion: 1 } } },
    live: [{ ticker: "X" }],
  }, "ok", NOW);
  assert.equal(recovered.status, "rows");
  assert.equal(recovered.rows.length, 1);
  assert.equal(recovered.rows[0].ticker, "GPT4O");
  assert.equal(recovered.rows[0].price, "$3,000.00");
  assert.equal(recovered.state.days.zzz, undefined);
  assert.equal(recovered.state.days["2026-10-29"]["openai/gpt-4o"].blend, 3000);
});

let passed = 0;
for (const entry of tests) {
  try {
    entry.fn();
    passed += 1;
    console.log(`ok - ${entry.name}`);
  } catch (error) {
    console.error(`not ok - ${entry.name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

console.log(`${passed} passed, ${tests.length - passed} failed`);
