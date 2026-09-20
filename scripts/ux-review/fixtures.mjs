export const account = { id:'alex',name:'Alex',pubkey:'a'.repeat(64),npub:'npub1alexexample0000000000000000000000000000',mode:'local',isActive:true,capabilities:{seedBacked:true,lightningLogin:{supported:true}},profile:{display_name:'Alex',nip05:'alex@example.com'} }
export const wallet = {id:'wallet',name:'Everyday wallet',type:'cashu',isActive:true,ownerAccountId:'alex',mints:['https://mint.example.com']}
export const tx = {type:'outgoing',state:'settled',amount:21000,fees_paid:1000,created_at:1789900000,settled_at:1789900001,payment_hash:'b'.repeat(64),description:'Coffee',metadata:{personalNote:'Saturday morning'}}
export const message = {id:'message',pubkey:'b'.repeat(64),sender:'b'.repeat(64),content:'See you tomorrow! Would 10:30 work for you?',created_at:1789900000,isSent:false,status:'delivered'}
export const fixtures = {account,wallet,messages:{['b'.repeat(64)]:[message,{...message,id:'reply',sender:'a'.repeat(64),isSent:true,content:'Yes, see you then!',created_at:1789900060}]},tx}
export function installMocks(fixtures) {
  window.__fixtures = fixtures
  const {account,wallet,tx} = fixtures
  const profile={display_name:'Blair',nip05:'blair@example.com',lud16:'blair@example.com'}
  const store={locale:'en',welcomeCompleted:true,mode:'light',profileCache:{['b'.repeat(64)]:profile}}
  const event={addListener(){},removeListener(){}}
  const area={get:async key=>typeof key==='string'?{[key]:store[key]}:store,set:async values=>Object.assign(store,values),remove:async()=>{}}
  window.chrome={storage:{local:area,session:area,onChanged:event},runtime:{getURL:p=>p,getManifest:()=>({version:'1.0.0'}),onMessage:event,sendMessage:async ({type})=>({result:({
    GET_ACCOUNTS:[account],GET_ACTIVE_ACCOUNT:account,GET_LOCK_STATE:{locked:false,passwordSet:true},GET_WALLETS:[wallet],GET_WALLET_STATUS:{connected:true,balance:2100,activeWallet:wallet},
    FETCH_PROFILE:profile,GET_PERMISSIONS:{'https://example.com':{getPublicKey:{decision:'allow'},signEvent:{decision:'allow'}}},GET_SESSION_PERMISSIONS:[],GET_ALLOWANCES:{},GET_RELAY_CONFIG:{account:['wss://relay.example.com'],wallet:['wss://relay.example.com'],chat:['wss://relay.example.com']},
    FETCH_RELAY_INFO:{name:'Example relay',description:'A community relay.',supported_nips:[1,17,44],software:'Example',contact:'support@example.com',pubkey:'b'.repeat(64),limitation:{auth_required:false,payment_required:false}},
    CREATE_NIP46_ACCOUNT:account,START_NOSTR_CONNECT:{uri:'nostrconnect://example',relay:'wss://relay.example.com'},GET_NIP46_STATUS:{connected:false},GET_ACTIVE_TAB_INFO:{origin:'https://example.com',host:'example.com'},CHECK_BACKUP_STATUS:{needsBackup:false},WALLET_LIST_TRANSACTIONS:{transactions:[tx]},WALLET_GET_BALANCE:{balance:2100},CASHU_GET_MINT_BALANCES:[],GET_LNURL_AUTH_SITES:[],GET_TRANSACTION_METADATA:{},
  })[type] ?? null})},tabs:{getCurrent:async()=>({id:1}),query:async()=>[],create:async()=>({})},permissions:{contains:async()=>true,request:async()=>true},alarms:{onAlarm:event},notifications:{},windows:{getCurrent:async()=>({type:'normal'})}}
  window.close=()=>{}
}
const cases=[]
const add=(id,component,state={},props={},extra={})=>cases.push({id,component,state,props,...extra})
for(const name of ['WelcomeScreen','LockScreen','LanguagePicker','ThemePicker','NotificationSettings','RelaySettings','LightningLogin','IdentityWizard','SiteContextBar']) add(name,name,{},name==='LightningLogin'?{account}:{})
add('unlock-error','UnlockForm',{}, {error:'The password is incorrect. Try again.',dismissible:true,origin:'https://example.com'})
for(const [id,mode,step,extra] of [
 ['choose-advanced',null,1,{showAdvanced:true}],['new','new',2],['import','import',2],['recover','recover',2],['remote','nip46',2],['remote-qr','nip46',2,{nip46Method:'nostrconnect'}],
 ['backup','new',3,{mnemonicDisplay:Array(12).fill('example')}],['backup-verify','new',3,{backupStage:'verify',backupChallenge:{type:'words',indices:[0,3,8]},backupAnswers:['','','']}],
 ['recover-select','recover',3,{recoveryCandidates:[{...account,accountIndex:0,used:true}],selectedRecoveryIndex:0}],['recover-profile','recover',4],['profile','new',4],['done','new',5],['import-done','import',3],['remote-done','nip46',3],
]) add('wizard-'+id,'IdentityWizard',{mode,step,createdAccount:account,...extra})
for(const page of ['AccountPage','ConnectedSitesPage','WalletPage','ActivityPage','MessagingPage','PreferencesPage','AboutPage','CashuMintSection','CashuBackupSection']) add(page,'options/'+page,{}, {},{width:900})
add('profile-edit','options/AccountPage',{showProfileEdit:true,profileForm:{name:'Alex',display_name:'Alex',about:'Hello'}} ,{}, {width:900})
add('delete-account','DeleteAccountSheet',{}, {account,hasWallet:true})
add('site-detail','SiteDetail',{}, {host:'https://example.com',methods:{getPublicKey:{decision:'allow'},'signEvent:1':{decision:'allow'}}})
add('revoke-site','SiteDetail',{confirmRevokeAll:true},{host:'https://example.com',methods:{getPublicKey:{decision:'allow'}}})
add('relay-info','RelayInfoSheet',{}, {url:'wss://relay.example.com',connected:true})
add('relay-technical','RelayInfoSheet',{showTechnical:true}, {url:'wss://relay.example.com',connected:true})
for(const name of ['NoWalletHome','WalletHome','WalletConnect','WalletSelector','TransactionHistory','SendFlow','ReceiveFlow']) add(name,'wallet/'+name)
for(const type of ['nwc','lnbits']) add('connect-'+type,'wallet/WalletConnect',{walletType:type})
for(const state of ['settled','pending','failed','expired']) add('receipt-'+state,'wallet/TransactionDetail',{}, {tx:{...tx,state,settled_at:state==='settled'?tx.settled_at:undefined,expires_at:state==='expired'?1780000000:undefined}})
for(const [step,extra] of [
 ['confirm',{input:'blair@example.com',amountSats:'21'}],['merchant-confirm',{merchantInfo:{name:'Coffee shop'},merchantStoreName:'Coffee shop',merchantSats:21}],['withdraw-confirm',{withdrawInfo:{minSats:1,maxSats:100,defaultDescription:'Refund'},withdrawAmountSats:'21'}],['request-confirm',{amountSats:'21',requestPayMint:'mint.example.com'}],['ecash-share',{shareAmountSats:'21'}],['result',{payResult:{preimage:'a'.repeat(64)},amountSats:'21'}]
]) add('send-'+step,'wallet/SendFlow',{step,...extra})
add('send-error','wallet/SendFlow',{payError:'Payment could not be sent. Try again.'})
add('send-fallback','wallet/SendFlow',{step:'result',requestFallback:{token:'cashuBfixture',amountSats:21,deliveryError:true,reclaimed:false}})
for(const [step,extra] of [['invoice',{invoice:'lnbc1fixture',amountSats:'21',polling:true}],['request',{requestEncoded:'creqAfixture',amountSats:'21',polling:true}],['success',{mintedAmount:21}]]) add('receive-'+step,'wallet/ReceiveFlow',{step,...extra})
add('receive-close','wallet/ReceiveFlow',{step:'invoice',invoice:'lnbc1fixture',confirmClose:true})
add('receive-ecash','wallet/ReceiveFlow',{receiveMode:'ecash'})
add('camera-unavailable','QrScanner',{cameraUnavailable:true,isExtensionPopup:true,error:''})
for(const name of ['ChatHome','ContactPicker','ChatThread','ReportDialog']) add(name,'chat/'+name,{}, {pubkey:'b'.repeat(64)})
add('chat-menu','chat/ChatThread',{showMenu:true},{pubkey:'b'.repeat(64)})
add('chat-compose-options','chat/ChatThread',{showComposeMenu:true},{pubkey:'b'.repeat(64)})
add('chat-zap','chat/ChatThread',{showZapPicker:true},{pubkey:'b'.repeat(64)})
add('message-actions','chat/ChatBubble',{showActions:true},{message,isSent:false})
for(const phase of ['connecting','success','error']) add('callback-'+phase,'nwc-callback',{phase,errorMsg:'The wallet could not be connected. Try connecting it again.'},{},{full:true,width:900})
for(const page of ['sites','account','wallets','activity','messaging','relays','preferences','about']) add('settings-'+page,'options',{activePage:page},{},{full:true,width:1024})
add('settings-narrow','options',{activePage:'preferences'},{},{full:true,width:390})
add('popup-account','popup',{activeTab:'identity'},{},{full:true})
add('popup-settings','popup',{showSettings:true},{},{full:true})
add('setup-password','LockScreen',{}, {isSetup:true})
add('setup-password-error','LockScreen',{password:'short',confirmPassword:'different'}, {isSetup:true,error:'Use at least 12 characters.'})
add('welcome-language','WelcomeScreen',{showLangPicker:true})
add('lightning-input','LightningLogin',{expanded:true},{account})
add('lightning-confirm','LightningLogin',{expanded:true,challenge:{origin:'https://example.com',domain:'example.com',action:'login'}},{account})
add('lightning-result','LightningLogin',{expanded:true,result:{ok:true,domain:'example.com'}},{account})
add('lightning-error','LightningLogin',{expanded:true,error:'This sign-in code is invalid.'},{account})
for (const backupStage of ['auth','show','verify','done']) add('account-backup-'+backupStage,'options/AccountPage',{showBackup:true,backupStage,backupKind:'mnemonic',backupNsec:Array(12).fill('example').join(' '),backupChallenge:{type:'words',indices:[0,3,8]},backupAnswers:['','','']},{},{width:900})
add('account-switch','options/AccountPage',{confirmSwitchId:'alex'},{},{width:900})
add('wallet-switch','wallet/WalletSelector',{open:true},{wallets:[wallet,{...wallet,id:'second',name:'Travel wallet',isActive:false}]})
add('wallet-rename','wallet/WalletSelector',{open:true,renamingId:'wallet',renameValue:'Everyday wallet'},{wallets:[wallet]})
add('wallet-remove','wallet/WalletSelector',{removingWallet:wallet},{wallets:[wallet]})
add('relay-remove','RelaySettings',{confirmRemoveUrl:'wss://relay.example.com'})
add('relay-reset','RelaySettings',{confirmReset:true})
add('backup-password','options/CashuBackupSection',{selectedImport:{name:'Wallet backup.buho',data:'fixture'}})
add('backup-import','options/CashuBackupSection',{selectedImport:{name:'Wallet backup.buho',data:'fixture'},pendingImport:{proofCount:4,mints:['https://mint.example.com'],hasReceivingKey:true}})
add('backup-relay','options/CashuBackupSection',{pendingRelay:{proofCount:4,mints:['https://mint.example.com'],hasReceivingKey:true}})
add('backup-words','options/CashuBackupSection',{pendingWordMints:[{url:'https://mint.example.com',checked:true}]})
add('password-change','options/PreferencesPage',{showPasswordChange:true},{},{width:900})
add('currency-picker','options/PreferencesPage',{showCurrencyPicker:true},{},{width:900})
add('chat-empty','chat/ChatHome',{}, {},{empty:true})
add('contacts-results','chat/ContactPicker',{input:'Blair',resolvedPubkey:'b'.repeat(64),resolvedProfile:{display_name:'Blair',nip05:'blair@example.com'}})
add('settings-messages','options/MessagingPage',{initializing:false},{},{width:900})
add('settings-contacts','options/MessagingPage',{initializing:false,tab:'contacts'},{},{width:900})
add('settings-thread','options/MessagingPage',{initializing:false,openThread:'b'.repeat(64)},{},{width:900})
add('popup-wallet','popup',{activeTab:'wallet'},{},{full:true})
add('popup-chat','popup',{activeTab:'chat'},{},{full:true})
add('popup-thread','popup',{activeTab:'chat',chatView:'thread',chatPubkey:'b'.repeat(64)},{},{full:true})
add('popup-sites','popup',{activeTab:'identity',showPermissionsPopup:true},{},{full:true})
for (const id of ['popup-account','wizard-new','wizard-recover','connect-lnbits','password-change','settings-narrow','delete-account','relay-info','lightning-confirm','send-confirm','receive-close','ReportDialog']) {
 const original=cases.find(c=>c.id===id)
 add(id+'-de-dark',original.component,original.state,original.props,{...original,id:id+'-de-dark',locale:'de',mode:'dark'})
}
const mintState={mintUrl:'https://mint.example.com',mintInfo:{name:'Community mint',description:'A mint for everyday payments.',version:'1.0',nuts:{}},cashuWalletId:'wallet'}
add('mint-details','options/CashuMintSection',{...mintState,showInfo:true})
add('mint-change','options/CashuMintSection',{...mintState,showChangeForm:true})
add('mint-confirm','options/CashuMintSection',{...mintState,confirmChange:true,newMintUrl:'https://new-mint.example.com',validatedInfo:{name:'New mint'}})
add('mint-explainer','options/CashuMintSection',{...mintState,showMintExplainer:true})
add('mint-permission','options/CashuMintSection',{...mintState,mintAccessGranted:false})
add('toast-success','ToastContainer',{toasts:[{id:1,type:'success',message:'Changes saved.',visible:true}]})
add('error-retry','ErrorBanner',{}, {message:'Could not load your messages.',type:'error',retryLabel:'Try again',dismissable:true})
add('popup-details','popup',{activeTab:'identity'},{},{full:true,details:true})
add('receive-mint-review','wallet/ReceiveFlow',{step:'request',requestEncoded:'creqAfixture',amountSats:'21',reviewPayment:{mintHost:'new-mint.example.com',mint:'https://new-mint.example.com',amountSats:21,token:'cashuBfixture'}})
add('send-quote-expired','wallet/SendFlow',{step:'merchant-confirm',countdown:0,merchantInfo:{name:'Coffee shop'},merchantStoreName:'Coffee shop'})
add('receive-error','wallet/ReceiveFlow',{error:'Could not create a payment request. Try again.'})
add('chat-content-warning','chat/ChatBubble',{}, {message:{...message,tags:[['content-warning','Sensitive content']]},isSent:false})
add('chat-reply','chat/ChatThread',{replyingTo:message,cwEnabled:true,expiryMinutes:60},{pubkey:'b'.repeat(64)})
add('chat-report-sheet','chat/ChatThread',{reportMessage:message},{pubkey:'b'.repeat(64)})
add('lightning-unavailable','LightningLogin',{}, {account:{...account,capabilities:{seedBacked:false}}})
add('notifications-quiet','NotificationSettings',{settings:{dms:true,payments:true,dnd:false,quietHours:true,quietStart:'22:00',quietEnd:'07:00'}})
for (const id of ['wizard-recover-de-dark','settings-narrow','delete-account']) {
 const original=cases.find(c=>c.id===id)
 cases.push({...original,id:id+'-large-text',fontScale:1.5})
}
export default cases
