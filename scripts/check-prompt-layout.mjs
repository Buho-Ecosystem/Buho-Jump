/** Render the production bundle with synthetic accounts and no network access. */
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = path.resolve('.output/chrome-mv3')
const server = createServer(async (req, res) => {
  try {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname)
    if (!file.startsWith(root + path.sep)) throw new Error('path')
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream')
    res.end(await readFile(file))
  } catch { res.writeHead(404); res.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) })
const out = process.env.UX_SCREENSHOTS || '/private/tmp/buho-ux-review'
await mkdir(out, { recursive: true })
const locales = ['en','de','cs','es','fr','it','pt','nl','sv','da','no','fi','ru','zh','ja','hi','th']
const variants = [ ['getPublicKey'], ['getRelays'], ...[0,1,3,4,5,6,7,9734,10002,22242,27235,30023,30078].map(kind => ['signEvent', kind]), ...['nip04_encrypt','nip04_decrypt','nip44_encrypt','nip44_decrypt','weblnEnable','weblnSendPayment','weblnKeysend'].map(method => [method]), ['unlock'] ]
const errors = []
let checked = 0
try {
  const page = await browser.newPage({ reducedMotion:'reduce' })
  page.on('pageerror', error => errors.push(error.message))
  await page.routeWebSocket('**', ws => ws.close())
  await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort())
  await page.addInitScript(() => {
    const locale = new URLSearchParams(location.search).get('testLocale') || 'en'
    const event = { kind: Number(new URLSearchParams(location.search).get('kind') || 1), content: 'A post to review before publishing. '.repeat(40), tags: [['u','https://jumble.social/login'],['method','POST']], amountSats: 21 }
    window.__responses = []
    const area = { get: async key => Array.isArray(key) ? { mode: new URLSearchParams(location.search).get('testMode') || 'dark' } : key === 'locale' ? { locale } : typeof key === 'string' && key.startsWith('prompt_event_') ? { [key]: event } : {}, set: async () => {}, remove: async () => {} }
    window.chrome = {
      storage: { local: area, session: area, onChanged: { addListener() {}, removeListener() {} } },
      runtime: { getURL: p => p, sendMessage: async message => {
        if (message.type === 'GET_ACCOUNTS') return { result: [{ id:'test-account', name:'Alex', pubkey:'a'.repeat(64), npub:'npub1example', mode:'local' }] }
        if (message.type === 'FETCH_PROFILE' && new URLSearchParams(location.search).has('stallProfile')) return new Promise(() => {})
        if (message.type === 'FETCH_PROFILE') return { result: { display_name:'Alex' } }
        if (message.type === 'PERMISSION_RESPONSE') { window.__responses.push(message.params[0]); return window.__failResponse ? { error:'EXPIRED_PERMISSION_REQUEST' } : { result:{ok:true} } }
        return { result: {} }
      } },
    }
    window.close = () => { window.__closed = true }
  })
  for (const locale of locales) {
    for (const [method, kind] of variants) {
      const heights = [...(method === 'unlock' ? [412] : []), ...(locale === 'en' || locale === 'de' ? [492,572,652] : [492])]
      for (const height of heights) {
        await page.setViewportSize({ width:method === 'unlock' && height === 412 ? 400 : 420, height })
        const query = new URLSearchParams({requestId:'test-request',profileId:'test-account',origin:'https://jumble.social',method,kind:String(kind ?? ''),testLocale:locale,...(method === 'unlock' ? {mode:'unlock'} : {})})
        await page.goto(`${base}/prompt.html?${query}`)
        await page.locator('.prompt-actions, .unlock-actions').waitFor()
        const dimensions = await page.evaluate(() => ({
          document: document.documentElement.scrollHeight, height: innerHeight, width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          buttons: [...document.querySelectorAll('.prompt-actions button, .unlock-actions button')].map(el => {const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,text:el.textContent}}),
        }))
        assert.ok(dimensions.document <= height + 1, `${locale} ${method} ${height}: document overflow ${JSON.stringify(dimensions)}`)
        assert.ok(dimensions.scrollWidth <= dimensions.width, 'horizontal overflow')
        assert.ok(dimensions.buttons.every(b => b.top >= 0 && b.bottom <= height && b.height >= 44), `${locale} ${method}: actions clipped`)
        if (method !== 'unlock') assert.equal(await page.locator('[data-decision="allow_all"]').count(), method.startsWith('webln') && method !== 'weblnEnable' ? 0 : 1)
        checked++
        if (['en','de'].includes(locale) && height === 492 && (method === 'getPublicKey' || (method === 'signEvent' && kind === 1))) await page.screenshot({animations:'disabled', path:`${out}/${locale}-${method}-${height}.png` })
      }
    }
  }
  await page.goto(`${base}/prompt.html?requestId=test-request&profileId=test-account&origin=https://jumble.social&method=getPublicKey`)
  await page.locator('[data-decision="allow_all"]').click()
  assert.equal(await page.evaluate(() => window.__responses[0]?.decision), 'allow_all')
  await page.reload()
  await page.evaluate(() => { window.__failResponse = true })
  await page.locator('[data-decision="allow_once"]').click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.evaluate(() => !!window.__closed), false, 'failed approval must not close the prompt')
  await page.reload()
  await page.locator('summary').click()
  await page.getByRole('button', { name:'Block this site', exact:true }).click()
  assert.equal(await page.evaluate(() => window.__responses[0]?.decision), 'deny_all')
  // Optional metadata must not delay login; long origins and enlarged text keep actions visible.
  for (const testMode of ['light','dark']) {
    await page.setViewportSize({width:420,height:492})
    const query = new URLSearchParams({requestId:'test',profileId:'test-account',method:'getPublicKey',origin:'https://' + 'long-account-name.'.repeat(5) + 'example.com',testLocale:'de',testMode,stallProfile:'1'})
    await page.goto(`${base}/prompt.html?${query}`)
    await page.locator('[data-decision="allow_once"]').waitFor({timeout:2000})
    await page.addStyleTag({content:'html {font-size:24px !important}'})
    const bounds = await page.locator('.prompt-actions').evaluate(el => {
      const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:document.documentElement.scrollWidth}
    })
    assert.ok(bounds.top >= 0 && bounds.bottom <= 492 && bounds.width <= 420, 'large text and a long origin keep the footer in view')
    await page.screenshot({animations:'disabled',path:`${out}/large-text-${testMode}.png`})
  }
  // Toolbar popup: inactive profile cache, account sheets, and eCash close guards.
  await page.addInitScript(() => {
    if (!location.pathname.endsWith('/popup.html') && !location.pathname.endsWith('/options.html')) return
    const account = { id:'alice', name:'Alex', pubkey:'a'.repeat(64), npub:'npub1alexexample0000000000000000000000000000', mode:'local', isActive:true }
    const accounts = [account, {id:'bob',name:'',pubkey:'b'.repeat(64),npub:'npub1bobexample0000000000000000000000000000000',mode:'local',isActive:false}]
    const wallet = {id:'wallet',name:'Everyday wallet',type:'cashu',isActive:true,ownerAccountId:'alice',mints:['https://mint.example.com']}
    const store = {locale:'en',welcomeCompleted:true,profileCache:{['b'.repeat(64)]:{display_name:'Blair',nip05:'blair@example.com'}}}
    const area = {get:async key => typeof key === 'string' ? {[key]:store[key]} : store, set:async values => Object.assign(store,values), remove:async () => {}}
    window.chrome.storage.local = area
    window.chrome.permissions = {contains:async()=>true,request:async()=>true}
    window.chrome.tabs = {getCurrent:async()=>undefined,query:async()=>[],create:async()=>({})}
    window.chrome.runtime.getManifest = () => ({version:'1.0.0'})
    window.chrome.runtime.onMessage = {addListener(){},removeListener(){}}
    window.__messages = []
    window.chrome.runtime.sendMessage = async message => {
      window.__messages.push(message.type)
      const responses = {
        CREATE_ACCOUNT_MNEMONIC:{...account,id:'new-account',mnemonic:'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'},GET_LOCK_STATE:{locked:false,passwordSet:true},GET_ACCOUNTS:accounts,GET_ACTIVE_ACCOUNT:account,FETCH_PROFILE:{display_name:'Alex'},
        GET_WALLET_STATUS:{connected:true,balance:1000,activeWallet:wallet},GET_WALLETS:[wallet],GET_PERMISSIONS:{},GET_SESSION_PERMISSIONS:[],GET_RELAY_CONFIG:{account:[],wallet:[],chat:[]},
        GET_ALLOWANCES:{},GET_ACTIVE_TAB_INFO:null,CHECK_BACKUP_STATUS:{needsBackup:false},WALLET_LIST_TRANSACTIONS:{transactions:[]},WALLET_GET_BALANCE:{balance:1000},WALLET_MAKE_INVOICE:{invoice:'lnbc1fixture'},GET_NIP46_STATUS:{},CASHU_CREATE_TOKEN:{token:'cashuBtest-token-for-ui-only'},CASHU_GET_MINT_BALANCES:[],
      }
      return {result:responses[message.type] ?? {}}
    }
  })
  await page.setViewportSize({width:380,height:600})
  await page.goto(`${base}/popup.html`)
  await page.getByRole('tab',{name:'Account',exact:true}).click()
  await page.getByText('Blair',{exact:true}).waitFor()
  assert.equal(await page.getByText('blair@example.com',{exact:true}).count(),1)
  assert.equal(await page.locator('button button').count(),0,'no nested account buttons')
  await page.screenshot({animations:'disabled',path:`${out}/account-list.png`})
  await page.getByRole('button',{name:/Blair/}).click()
  await page.getByRole('dialog').waitFor()
  assert.equal(await page.getByRole('dialog').getByText('Blair',{exact:true}).count(),1)
  await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click()
  await page.getByRole('tab',{name:'Wallet',exact:true}).click()
  await page.getByRole('button',{name:'Send',exact:true}).click()
  await page.getByRole('button',{name:'Share eCash as a QR code instead',exact:true}).click()
  await page.getByRole('dialog').locator('input[type="number"]').first().fill('21')
  await page.getByRole('button',{name:'Create eCash',exact:true}).click()
  await page.getByRole('button',{name:'Take it back',exact:true}).waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('button',{name:'Take it back',exact:true}).count(),1,'Escape must keep fresh eCash visible')
  await page.screenshot({animations:'disabled',path:`${out}/ecash-close-guard.png`})
  await page.getByRole('button',{name:'Done',exact:true}).click()
  await page.getByRole('button',{name:'Receive',exact:true}).click()
  await page.getByRole('dialog').locator('input[type="number"]').first().fill('21')
  await page.getByRole('button',{name:'Create invoice',exact:true}).click()
  await page.locator('[data-copy-invoice]').first().waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog',{name:'Close this payment request?'}).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog',{name:'Close this payment request?'}).waitFor({state:'hidden'})
  assert.equal(await page.locator('[data-copy-invoice]').first().count(),1,'Escape dismisses only the confirmation')
  await page.keyboard.press('Escape')
  const confirm = page.getByRole('dialog',{name:'Close this payment request?'})
  await confirm.getByRole('button',{name:'Close',exact:true}).click()
  await page.getByRole('button',{name:'Receive',exact:true}).waitFor()
  await page.goto(`${base}/options.html?page=account`)
  await page.getByText('Blair',{exact:true}).waitFor()
  await page.screenshot({animations:'disabled',path:`${out}/options-account.png`})
  await page.goto(`${base}/popup.html`)
  await page.getByRole('tab',{name:'Account',exact:true}).click()
  await page.getByRole('button',{name:'Add account',exact:true}).click()
  await page.getByRole('button',{name:/Create a new account/}).click()
  await page.getByPlaceholder('e.g. satoshi, alice, your_name').fill('Taylor')
  await page.getByRole('button',{name:'Create account',exact:true}).click()
  await page.getByRole('heading',{name:"You're all set",exact:true}).waitFor()
  assert.equal(await page.getByText('Back up your account key to avoid losing access',{exact:true}).count(),1)
  const startBounds = await page.getByRole('button',{name:'Get started',exact:true}).boundingBox()
  assert.ok(startBounds.y + startBounds.height <= 500, 'new account primary action fits the initial popup viewport')
  const requests = await page.evaluate(() => window.__messages)
  assert.ok(!requests.includes('CONFIRM_IDENTITY_BACKUP'),'deferring backup cannot mark it verified')
  assert.ok(!requests.includes('PUBLISH_PROFILE'),'profile publishing remains opt-in')
  await page.screenshot({animations:'disabled',path:`${out}/new-account-done.png`})
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ checked, decisions:'allow_all, deny_all and failed response', screenshots:out }))
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
