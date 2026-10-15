import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTokenCommand, normalizeYears, normalizeName, secondsOf, expiryOf, formatExpiry, DEFAULT_YEARS, SUGGESTED_MAX_YEARS } from '../connectors/teambition/token-command.js'

test('expired is emitted in seconds and the expiry date is shown to the user', () => {
  assert.equal(secondsOf(10), 315360000)
  const built = buildTokenCommand({ years: 10, from: new Date('2026-10-10T12:00:00+08:00') })
  assert.equal(built.expiryText, formatExpiry(expiryOf(10, new Date('2026-10-10T12:00:00+08:00'))))
  assert.match(built.command, /const YEARS = 10;/)
  assert.match(built.command, /YEARS \* 365 \* 24 \* 60 \* 60/)
})

test('generated command is valid JavaScript and never embeds a credential', () => {
  const built = buildTokenCommand({ years: 3 })
  assert.doesNotThrow(() => new Function(built.command))
  assert.match(built.command, /open\.teambition\.com\/api\/v1\/developer\/organization\/\$\{org\._id\}\/mcp\/userTokens/)
  assert.match(built.command, /www\.teambition\.com\/api\/users\/me/)
  assert.match(built.command, /wh:\$\{/)
  assert.ok(!/userToken=[A-Za-z0-9-]{8,}/.test(built.command))
})

test('invalid years fall back to the default with a warning, absent years silently', () => {
  for (const value of ['abc', 0, -1, '', NaN, Infinity]) {
    const built = buildTokenCommand({ years: value })
    assert.equal(built.years, DEFAULT_YEARS, `years=${String(value)}`)
    assert.ok(built.warnings.some((line) => line.includes('大于 0')), `years=${String(value)}`)
  }
  assert.equal(buildTokenCommand({}).years, DEFAULT_YEARS)
  assert.ok(!buildTokenCommand({}).warnings.some((line) => line.includes('大于 0')))
  assert.equal(normalizeYears(7).years, 7)
})

test('long lifetimes are called out but still honoured', () => {
  const built = buildTokenCommand({ years: SUGGESTED_MAX_YEARS + 50 })
  assert.ok(built.warnings.some((line) => line.includes('长期全权限钥匙')))
  assert.match(built.command, /const YEARS = 70;/)
  assert.ok(!buildTokenCommand({ years: 1 }).warnings.some((line) => line.includes('长期全权限钥匙')))
})

test('a user-supplied name is used verbatim and stays inert inside the command', () => {
  const built = buildTokenCommand({ years: 1, name: '  wh:张三:工作机  ' })
  assert.equal(built.tokenName, 'wh:张三:工作机')
  assert.equal(built.namePreview, 'wh:张三:工作机')
  assert.match(built.command, /const NAME = "wh:张三:工作机";/)
  assert.doesNotThrow(() => new Function(built.command))
})

test('hostile names cannot break out of the generated command', () => {
  for (const hostile of ["a'b", 'a`b', 'a${x}b', 'a"; console.log(1); //', 'a\nb', 'a\tb']) {
    const built = buildTokenCommand({ years: 1, name: hostile })
    assert.doesNotThrow(() => new Function(built.command), hostile)
    assert.ok(!/\n\s*console\.log\(1\)/.test(built.command), hostile)
  }
  assert.equal(normalizeName('x'.repeat(99)).name.length, 40)
})

test('an empty name keeps the automatic convention', () => {
  const built = buildTokenCommand({ years: 2, name: '   ', from: new Date('2026-10-10T12:00:00+08:00') })
  assert.equal(built.tokenName, '')
  assert.equal(built.namePreview, 'wh:<你的姓名>:202610')
  assert.match(built.command, /const NAME = "";/)
  assert.match(built.command, /const name = NAME \|\| `wh:\$\{/)
})

test('scopes are always the full wildcard that Teambition offers', () => {
  assert.match(buildTokenCommand({ years: 1 }).command, /scopes: \['\*'\]/)
})
