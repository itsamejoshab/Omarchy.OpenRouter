.pragma library

// Pure formatting for the OpenRouter widget. Kept out of the QML so the
// wording and rounding rules are readable in one place.

// -1 is the widget's "OpenRouter did not say", which is not the same as zero
// credit left, and must never be drawn as a figure.
function known(value) {
  return typeof value === "number" && isFinite(value) && value >= 0
}

function group(digits) {
  return String(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

// Credits are dollars on OpenRouter, so they read as money.
function money(value, decimals) {
  if (typeof value !== "number" || !isFinite(value)) return "—"
  var places = decimals === undefined ? 2 : decimals
  var fixed = Math.abs(value).toFixed(places)
  var parts = fixed.split(".")
  parts[0] = group(parts[0])
  return (value < 0 ? "-$" : "$") + parts.join(".")
}

// The bar has room for a figure, not for a ledger: cents below a thousand,
// whole credits above it, and thousands once the account is large enough that
// the exact cent stopped being the point.
function compactMoney(value) {
  if (typeof value !== "number" || !isFinite(value)) return "—"
  var magnitude = Math.abs(value)
  if (magnitude >= 10000) return (value < 0 ? "-$" : "$") + (magnitude / 1000).toFixed(1) + "k"
  if (magnitude >= 1000) return money(value, 0)
  return money(value, 2)
}

function percent(ratio) {
  if (typeof ratio !== "number" || !isFinite(ratio) || ratio < 0) return "—"
  return Math.round(ratio * 100) + "%"
}

function resetPhrase(reset) {
  var value = String(reset || "").toLowerCase()
  if (value === "daily") return "resets daily"
  if (value === "weekly") return "resets weekly"
  if (value === "monthly") return "resets monthly"
  return ""
}

// What the headline figure actually is, so the panel never leaves the reader
// guessing whether they are looking at an account or a single key.
function sourceMeta(source, freeTier) {
  if (source === "account") return "Account balance"
  if (source === "key") return "Key spend cap"
  if (source === "usage") return freeTier ? "Free tier" : "Spend only"
  return "Not connected"
}

function balanceDetail(funded, spent) {
  if (!known(funded) || !known(spent)) return ""
  return "Spent " + money(spent) + " of " + money(funded) + " purchased"
}

// The primary caption under the balance meter once today's account-wide
// spend is known; balanceDetail is the fallback for keys that cannot read
// /activity, which is most of them.
function todaySpendDetail(spendToday) {
  if (!known(spendToday)) return ""
  return "Spent " + money(spendToday) + " today"
}

function capDetail(limit, remaining, reset) {
  if (!known(limit)) return ""
  var used = known(remaining) ? limit - remaining : -1
  var text = known(used) ? "Used " + money(used) + " of " + money(limit) : "Cap " + money(limit)
  var phrase = resetPhrase(reset)
  return phrase === "" ? text : text + " · " + phrase
}

function relativeAge(fetchedAtSeconds, nowMs) {
  if (!fetchedAtSeconds) return ""
  var seconds = Math.max(0, Math.round(nowMs / 1000 - fetchedAtSeconds))
  if (seconds < 45) return "just now"
  if (seconds < 90) return "1 min ago"
  if (seconds < 3600) return Math.round(seconds / 60) + " min ago"
  var hours = Math.round(seconds / 3600)
  if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago")
  var days = Math.round(hours / 24)
  return days + (days === 1 ? " day ago" : " days ago")
}

// Bar tooltip: the figure plus what it is a figure of. `hasRemaining` is
// passed rather than inferred, because an overspent account reports a
// negative balance and that is a figure worth showing.
function tooltip(source, remaining, hasRemaining, freeTier) {
  var label = sourceMeta(source, freeTier)
  if (!hasRemaining) return "OpenRouter · " + label
  return "OpenRouter · " + money(remaining) + " left · " + label.toLowerCase()
}

// Spend rows, skipping any window OpenRouter did not report rather than
// drawing it as $0.00 and claiming a quiet day. Today is not one of these
// rows: it already has its own line under the balance meter above.
function spendRows(weekly, monthly, allTime) {
  var rows = []
  if (known(weekly)) rows.push({ label: "This week", value: money(weekly) })
  if (known(monthly)) rows.push({ label: "This month", value: money(monthly) })
  if (known(allTime)) rows.push({ label: "All time", value: money(allTime) })
  return rows
}

// Sample cell before any quote has loaded. The visible quote is the ticker
// and the price with one space, and there is no model id to hover.
function placeholderRow() {
  return { ticker: "XXXXX", price: "$0.00" }
}

function placeholderRows() {
  return [placeholderRow(), placeholderRow(), placeholderRow(), placeholderRow()]
}

// Prices are decimals, and display rounding is half away from zero. Binary
// Math.round / toFixed mis-rounds values such as 1.005, so the tape keeps the
// decimal as an integer digit string (value = digits / 10^scale) until it
// formats the string it will paint.

function stripLeadingZeros(digits) {
  var trimmed = String(digits || "").replace(/^0+/, "")
  return trimmed === "" ? "0" : trimmed
}

function zeros(count) {
  if (count <= 0) return ""
  return new Array(count + 1).join("0")
}

function addDigits(left, right) {
  var carry = 0
  var out = ""
  var i = left.length - 1
  var j = right.length - 1
  while (i >= 0 || j >= 0 || carry) {
    var digit = carry
    if (i >= 0) digit += left.charCodeAt(i--) - 48
    if (j >= 0) digit += right.charCodeAt(j--) - 48
    out = String(digit % 10) + out
    carry = Math.floor(digit / 10)
  }
  return stripLeadingZeros(out)
}

function mulSmall(digits, factor) {
  if (factor === 0 || digits === "0") return "0"
  var carry = 0
  var out = ""
  for (var i = digits.length - 1; i >= 0; i--) {
    var digit = (digits.charCodeAt(i) - 48) * factor + carry
    out = String(digit % 10) + out
    carry = Math.floor(digit / 10)
  }
  if (carry) out = String(carry) + out
  return stripLeadingZeros(out)
}

function shiftDigits(digits, places) {
  if (places <= 0 || digits === "0") return digits
  return digits + zeros(places)
}

// Optional sign, digits, optional fractional part, and nothing else.
// A numeric string counts. Null, blank, objects, and partials such as "1abc" do not.
function parsePrice(value) {
  if (typeof value !== "string") return null
  var match = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(value)
  if (!match) return null
  var frac = match[3] || ""
  var digits = stripLeadingZeros(match[2] + frac)
  return {
    neg: match[1] === "-" && digits !== "0",
    digits: digits,
    scale: frac.length
  }
}

function mulPow10(dec, pow) {
  var scale = dec.scale - pow
  var digits = dec.digits
  if (scale < 0) {
    digits = shiftDigits(digits, -scale)
    scale = 0
  }
  return { neg: dec.neg, digits: digits, scale: scale }
}

function addDec(left, right) {
  var scale = Math.max(left.scale, right.scale)
  return {
    neg: false,
    digits: addDigits(shiftDigits(left.digits, scale - left.scale), shiftDigits(right.digits, scale - right.scale)),
    scale: scale
  }
}

// Dividing by 4 is exact once two extra factors of ten are present.
function divBy4(dec) {
  var digits = shiftDigits(dec.digits, 2)
  var remainder = 0
  var out = ""
  for (var i = 0; i < digits.length; i++) {
    remainder = remainder * 10 + (digits.charCodeAt(i) - 48)
    out += String(Math.floor(remainder / 4))
    remainder = remainder % 4
  }
  return { neg: dec.neg, digits: stripLeadingZeros(out), scale: dec.scale + 2 }
}

function plainDecimal(dec) {
  var digits = dec.digits
  var scale = dec.scale
  if (digits === "0") return "0"
  if (scale > 0 && digits.length <= scale) digits = zeros(scale - digits.length + 1) + digits
  if (scale <= 0) return shiftDigits(digits, -scale)
  var whole = digits.slice(0, digits.length - scale)
  var frac = digits.slice(digits.length - scale).replace(/0+$/, "")
  if (whole === "") whole = "0"
  if (frac === "") return whole
  return whole + "." + frac
}

function decimalNumber(dec) {
  return Number(plainDecimal(dec))
}

function underOneCent(plain) {
  var dot = plain.indexOf(".")
  var whole = dot === -1 ? plain : plain.slice(0, dot)
  if (whole !== "0") return false
  var frac = dot === -1 ? "" : plain.slice(dot + 1)
  return (frac + "00").slice(0, 2) === "00"
}

function roundHalfAway(plain, places) {
  var dot = plain.indexOf(".")
  var whole = dot === -1 ? plain : plain.slice(0, dot)
  var frac = dot === -1 ? "" : plain.slice(dot + 1)
  if (frac.length < places + 1) frac += zeros(places + 1 - frac.length)
  var keep = frac.slice(0, places)
  var next = frac.charAt(places)
  var combined = whole + keep
  if (next >= "5") combined = addDigits(combined, "1")
  if (combined.length < whole.length + places) combined = zeros(whole.length + places - combined.length) + combined
  var roundedWhole = combined.slice(0, combined.length - places)
  var roundedFrac = combined.slice(combined.length - places)
  if (roundedWhole === "") roundedWhole = "0"
  return { whole: roundedWhole, frac: roundedFrac }
}

function formatListing(dec) {
  var plain = plainDecimal(dec)
  var places = plain === "0" || !underOneCent(plain) ? 2 : 4
  var rounded = roundHalfAway(plain, places)
  return "$" + group(rounded.whole) + "." + rounded.frac
}

function hoverText(prompt, completion) {
  return "in " + formatListing(prompt) + " \u00b7 out " + formatListing(completion) + " per million"
}

function isVersionToken(token) {
  return /^(?:v)?\d+(?:\.\d+)*$/.test(token)
}

function providerMark(provider) {
  for (var i = 0; i < provider.length; i++) {
    var ch = provider.charAt(i)
    if (/[A-Za-z0-9]/.test(ch)) return ch.toUpperCase()
  }
  return "X"
}

// Base ticker, plus the uncut stem and the provider mark used when it collides.
function tickerParts(id) {
  var text = String(id || "")
  var slash = text.indexOf("/")
  var provider = "X"
  var name = text
  if (slash !== -1) {
    provider = text.slice(0, slash)
    name = text.slice(slash + 1)
  }
  var colon = name.indexOf(":")
  if (colon !== -1) name = name.slice(0, colon)
  if (/-\d{4}$/.test(name)) name = name.slice(0, -5)
  var raw = name.split("-")
  var tokens = []
  for (var i = 0; i < raw.length; i++) {
    if (raw[i] !== "preview" && raw[i] !== "latest") tokens.push(raw[i])
  }
  var other = false
  for (var j = 0; j < tokens.length; j++) {
    if (!isVersionToken(tokens[j])) other = true
  }
  if (other) {
    var kept = []
    for (var k = 0; k < tokens.length; k++) {
      if (!isVersionToken(tokens[k])) kept.push(tokens[k])
    }
    tokens = kept
  }
  if (tokens.length > 1 && (tokens[0] === "claude" || tokens[0] === "deepseek" || tokens[0] === "minimax"))
    tokens = tokens.slice(1)
  var stem = tokens.join("").replace(/[^A-Za-z0-9]/g, "").toUpperCase()
  var base = stem
  var vowels = { A: true, E: true, I: true, O: true, U: true }
  while (base.length > 5) {
    var cut = -1
    for (var n = base.length - 1; n >= 1; n--) {
      if (vowels[base.charAt(n)]) { cut = n; break }
    }
    if (cut === -1) break
    base = base.slice(0, cut) + base.slice(cut + 1)
  }
  if (base.length > 5) base = base.slice(0, 5)
  return { provider: providerMark(provider), stem: stem, base: base }
}

// The provider letter plus a suffix of the uncut stem. Length 5 first, then
// more of that stem up to 7, then the last character replaced by 2 through 9.
function disambiguate(provider, stem, taken) {
  var full = provider.length + stem.length
  var start = Math.min(5, full)
  var end = Math.min(7, full)
  var len
  for (len = start; len <= end; len++) {
    var need = len - provider.length
    var ticker = provider + stem.slice(stem.length - need)
    if (!taken[ticker]) return ticker
  }
  var longest = provider + stem.slice(stem.length - (end - provider.length))
  for (var digit = 2; digit <= 9; digit++) {
    var candidate = longest.slice(0, -1) + String(digit)
    if (!taken[candidate]) return candidate
  }
  return null
}

function isAliasObject(value) {
  return value !== null && typeof value === "object"
}

function qualifying(payload) {
  var found = []
  if (!Array.isArray(payload)) return found
  for (var i = 0; i < payload.length; i++) {
    var entry = payload[i]
    if (!entry || typeof entry !== "object") continue
    if (typeof entry.id !== "string" || entry.id === "") continue
    if (typeof entry.alias_target === "string" && entry.alias_target !== "") continue
    if (isAliasObject(entry.alias_target)) continue
    var pricing = entry.pricing
    if (!pricing || typeof pricing !== "object") continue
    var prompt = parsePrice(pricing.prompt)
    var completion = parsePrice(pricing.completion)
    if (!prompt || !completion || prompt.neg || completion.neg) continue
    var perBillionIn = mulPow10(prompt, 9)
    var perBillionOut = mulPow10(completion, 9)
    var perMillionIn = mulPow10(prompt, 6)
    var perMillionOut = mulPow10(completion, 6)
    var blend = divBy4(addDec({ neg: false, digits: mulSmall(perBillionIn.digits, 3), scale: perBillionIn.scale }, perBillionOut))
    found.push({
      id: entry.id,
      parts: tickerParts(entry.id),
      blend: blend,
      prompt: perMillionIn,
      completion: perMillionOut
    })
  }
  return found
}

function buildTape(models) {
  var taken = {}
  var live = []
  var rows = []
  for (var i = 0; i < models.length; i++) {
    var model = models[i]
    var ticker = null
    if (!taken[model.parts.base]) ticker = model.parts.base
    else ticker = disambiguate(model.parts.provider, model.parts.stem, taken)
    if (ticker) taken[ticker] = true
    var price = ticker ? formatListing(model.blend) : null
    var hover = hoverText(model.prompt, model.completion)
    live.push({
      id: model.id,
      blend: decimalNumber(model.blend),
      prompt: decimalNumber(model.prompt),
      completion: decimalNumber(model.completion),
      ticker: ticker,
      price: price,
      hover: hover
    })
    if (!ticker) continue
    rows.push({
      id: model.id,
      ticker: ticker,
      price: price,
      arrow: "none",
      hover: hover
    })
  }
  return { live: live, rows: rows }
}

function isUtcDateKey(key) {
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false
  var parts = key.split("-")
  return utcDate(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))) === key
}

function copyModelRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null
  if (typeof record.blend !== "number" || !isFinite(record.blend)) return null
  if (typeof record.prompt !== "number" || !isFinite(record.prompt)) return null
  if (typeof record.completion !== "number" || !isFinite(record.completion)) return null
  return { blend: record.blend, prompt: record.prompt, completion: record.completion }
}

function copyLiveEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null
  if (typeof entry.id !== "string" || entry.id === "") return null
  var ticker = null
  if (entry.ticker == null || entry.ticker === "") ticker = null
  else if (typeof entry.ticker === "string") ticker = entry.ticker
  else return null
  var price = typeof entry.price === "string" && entry.price !== "" ? entry.price : null
  // A ticker with no price would paint a blank quote. A null ticker is a
  // model kept for the day after a symbol collision, and it is not painted.
  if (ticker && !price) return null
  return {
    id: entry.id,
    blend: typeof entry.blend === "number" && isFinite(entry.blend) ? entry.blend : null,
    prompt: typeof entry.prompt === "number" && isFinite(entry.prompt) ? entry.prompt : null,
    completion: typeof entry.completion === "number" && isFinite(entry.completion) ? entry.completion : null,
    ticker: ticker,
    price: ticker ? price : null,
    hover: typeof entry.hover === "string" ? entry.hover : null
  }
}

// A missing or wrong-shaped document is no history. A date key that is not a
// real UTC day, or a live row with no price, must not stick the tape.
function copyState(state) {
  var saved = { days: null, live: null }
  if (!state || typeof state !== "object" || Array.isArray(state)) return saved
  if (state.days && typeof state.days === "object" && !Array.isArray(state.days)) {
    var days = {}
    var anyDay = false
    for (var key in state.days) {
      if (!isUtcDateKey(key)) continue
      var record = state.days[key]
      if (!record || typeof record !== "object" || Array.isArray(record)) continue
      var models = {}
      var anyModel = false
      for (var id in record) {
        var copied = copyModelRecord(record[id])
        if (!copied) continue
        models[id] = copied
        anyModel = true
      }
      if (!anyModel) continue
      days[key] = models
      anyDay = true
    }
    if (anyDay) saved.days = days
  }
  if (Array.isArray(state.live)) {
    var live = []
    for (var i = 0; i < state.live.length; i++) {
      var entry = copyLiveEntry(state.live[i])
      if (entry) live.push(entry)
    }
    if (live.length > 0) saved.live = live
  }
  return saved
}

function utcDate(ms) {
  var date = new Date(ms)
  if (!isFinite(date.getTime())) return ""
  var year = date.getUTCFullYear()
  var month = date.getUTCMonth() + 1
  var day = date.getUTCDate()
  return year + "-" + (month < 10 ? "0" : "") + month + "-" + (day < 10 ? "0" : "") + day
}

function shiftUtcDate(date, days) {
  var parts = String(date || "").split("-")
  if (parts.length !== 3) return ""
  return utcDate(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + days))
}

// Calendar age: a day strictly before today minus 30 days is gone. Gap days
// are simply absent, so this is not a count of records.
function pruneDays(days, today) {
  if (!days || typeof days !== "object") return null
  var cutoff = shiftUtcDate(today, -30)
  var next = {}
  var any = false
  for (var key in days) {
    if (cutoff && key < cutoff) continue
    next[key] = days[key]
    any = true
  }
  return any ? next : null
}

function newestDay(days) {
  var newest = ""
  if (!days) return ""
  for (var key in days) {
    if (key > newest) newest = key
  }
  return newest
}

function baselineRecord(days, today, id) {
  var best = ""
  if (!days) return null
  for (var key in days) {
    if (!(key < today)) continue
    var record = days[key]
    if (!record || typeof record !== "object" || record[id] == null) continue
    if (key > best) best = key
  }
  return best === "" ? null : days[best][id]
}

function expandNumber(value) {
  if (typeof value !== "number" || !isFinite(value)) return null
  if (value === 0) return "0"
  var text = String(Math.abs(value))
  if (text.indexOf("e") === -1 && text.indexOf("E") === -1) return text
  var parts = text.toLowerCase().split("e")
  var mantissa = parts[0]
  var exponent = Number(parts[1])
  var digits = mantissa.replace(".", "")
  var dot = mantissa.indexOf(".")
  var scale = dot === -1 ? 0 : mantissa.length - dot - 1
  var power = exponent - scale
  if (power >= 0) return stripLeadingZeros(digits + zeros(power))
  var point = digits.length + power
  if (point > 0) return stripLeadingZeros(digits.slice(0, point)) + "." + digits.slice(point)
  return "0." + zeros(-point) + digits
}

function formatStored(value) {
  var plain = expandNumber(value)
  if (plain == null) return null
  var places = plain === "0" || !underOneCent(plain) ? 2 : 4
  var rounded = roundHalfAway(plain, places)
  return "$" + group(rounded.whole) + "." + rounded.frac
}

function parseDisplay(text) {
  var parsed = Number(String(text || "").replace(/[$,]/g, ""))
  return isFinite(parsed) ? parsed : 0
}

function arrowBetween(livePrice, baselinePrice) {
  if (baselinePrice == null || livePrice === baselinePrice) return "none"
  var live = parseDisplay(livePrice)
  var baseline = parseDisplay(baselinePrice)
  if (live > baseline) return "up"
  if (live < baseline) return "down"
  return "none"
}

function paintArrow(row, days, today) {
  var prior = baselineRecord(days, today, row.id)
  var baselinePrice = prior && typeof prior.blend === "number" ? formatStored(prior.blend) : null
  row.arrow = arrowBetween(row.price, baselinePrice)
}

function rowsFromLive(live, days, today) {
  var rows = []
  if (!Array.isArray(live)) return rows
  for (var i = 0; i < live.length; i++) {
    var entry = live[i]
    if (!entry || entry.ticker == null || entry.ticker === "") continue
    var row = {
      id: entry.id,
      ticker: entry.ticker,
      price: entry.price,
      arrow: "none",
      hover: entry.hover
    }
    paintArrow(row, days, today)
    rows.push(row)
  }
  return rows
}

function dayRecordFrom(models) {
  var record = {}
  for (var i = 0; i < models.length; i++) {
    var model = models[i]
    record[model.id] = {
      blend: decimalNumber(model.blend),
      prompt: decimalNumber(model.prompt),
      completion: decimalNumber(model.completion)
    }
  }
  return record
}

// payload is the models array or null. state is the last saved document or
// null. now is UTC milliseconds. outcome is "pending", "error", or "ok".
// The returned state is what gets persisted; callers pass it back in.
function decide(payload, state, now, outcome) {
  var saved = copyState(state)
  var today = utcDate(now)
  var days = pruneDays(saved.days, today)
  if (outcome === "ok") {
    var models = qualifying(Array.isArray(payload) ? payload : [])
    if (models.length === 0) {
      return { status: "unavailable", rows: [], state: { days: days, live: null } }
    }
    var built = buildTape(models)
    var newest = newestDay(days)
    // A clock behind the newest saved day must not add or rewrite days.
    if (!(newest && today < newest)) {
      if (!days) days = {}
      if (!days[today]) days[today] = dayRecordFrom(models)
    }
    for (var i = 0; i < built.rows.length; i++) paintArrow(built.rows[i], days, today)
    return { status: "rows", rows: built.rows, state: { days: days, live: built.live } }
  }
  var painted = rowsFromLive(saved.live, days, today)
  if (painted.length > 0) {
    return { status: "rows", rows: painted, state: { days: days, live: saved.live } }
  }
  if (outcome === "error") {
    return { status: "unavailable", rows: [], state: { days: days, live: saved.live } }
  }
  return { status: "empty", rows: placeholderRows(), state: { days: days, live: saved.live } }
}
