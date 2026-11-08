/* Summit's browser workspace. The audit engine is served by Unison at /api/analyze. */
'use strict';

const SummitData = (() => {
  const sampleAuditSource = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Trail Essentials for Your Next Hike | Summit Outdoors</title>
    <meta name="description" content="Pack with confidence for your next hike. Explore our practical guide to trail essentials, from comfortable footwear to the small items that make a difference.">
    <link rel="canonical" href="https://summitoutdoors.example/blog/trail-essentials">
  </head>
  <body>
    <h1>Trail essentials for your next hike</h1>
    <p>A little preparation makes room for a better adventure.</p>
    <img src="forest-trail.jpg" alt="A winding trail through a green forest">
    <img src="hiking-backpack.jpg">
  </body>
</html>`;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const validUrl = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password; } catch { return false; } };
  function csvRows(text) {
    const rows = []; let row = [], cell = '', quoted = false, closed = false;
    const input = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < input.length; i++) {
      const c = input[i];
      if (quoted) {
        if (c === '"') { if (input[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
        else cell += c;
      } else if (c === '"') {
        if (cell.trim() || closed) throw new Error('The CSV contains an unexpected quotation mark. Please export it again.');
        cell = ''; quoted = true;
      } else if (c === ',') { row.push(cell.trim()); cell = ''; closed = false; }
      else if (c === '\r' || c === '\n') {
        if (c === '\r' && input[i + 1] === '\n') i++;
        row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; closed = false;
      } else { if (closed && c.trim()) throw new Error('The CSV contains text after a closing quote.'); cell += c; }
    }
    if (quoted) throw new Error('The CSV contains an unclosed quotation mark.');
    row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
    return rows;
  }
  function parseCsv(text) {
    if (typeof text !== 'string' || text.length > 2_000_000) throw new Error('Choose a CSV smaller than 2 MB.');
    const rows = csvRows(text);
    if (rows.length < 2) throw new Error('Add a header row and at least one page of metrics.');
    if (rows.length > 5001) throw new Error('Import up to 5,000 pages at a time.');
    const header = rows[0].map(x => x.toLowerCase().replace(/\s+/g, ' ').trim());
    const pageIndex = header.findIndex(x => x === 'page' || x === 'top pages');
    const columns = [pageIndex, ...['clicks','impressions','ctr','position'].map(x => header.indexOf(x))];
    if (columns.some(x => x < 0)) throw new Error('Use the columns Page (or Top pages), Clicks, Impressions, CTR, and Position.');
    const seen = new Set();
    return rows.slice(1).map((row, i) => {
      const line = i + 2;
      if (row.length !== header.length) throw new Error(`Row ${line} has a different number of columns than the header.`);
      const url = row[columns[0]];
      if (!validUrl(url)) throw new Error(`Row ${line} needs a valid http or https page URL.`);
      if (seen.has(url)) throw new Error(`Row ${line} repeats a page URL. Each page should appear once.`);
      seen.add(url);
      const parseNumber = (index, label, percent = false) => {
        let value = row[index].replace(/,/g, '');
        if (percent) value = value.replace(/%$/, '').trim();
        if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) throw new Error(`Row ${line} has an invalid ${label} value.`);
        const number = Number(value);
        if (!Number.isFinite(number)) throw new Error(`Row ${line} has an invalid ${label} value.`);
        return number;
      };
      const clicks = parseNumber(columns[1], 'Clicks'), impressions = parseNumber(columns[2], 'Impressions');
      const ctr = parseNumber(columns[3], 'CTR', true), position = parseNumber(columns[4], 'Position');
      if (!Number.isSafeInteger(clicks) || !Number.isSafeInteger(impressions) || clicks > impressions) throw new Error(`Row ${line}: Clicks and Impressions must be whole numbers, with Clicks no greater than Impressions.`);
      if (ctr > 100 || position > 1000) throw new Error(`Row ${line}: CTR must be 0–100% and Position must be 0–1,000.`);
      return {url, clicks, impressions, ctr, position};
    });
  }
  function totals(pages) {
    const clicks = pages.reduce((sum, x) => sum + x.clicks, 0), impressions = pages.reduce((sum, x) => sum + x.impressions, 0);
    return {clicks, impressions, ctr: impressions ? clicks / impressions * 100 : 0, position: impressions ? pages.reduce((sum, x) => sum + x.position * x.impressions, 0) / impressions : 0};
  }
  function validateState(value) {
    const safe = {version:1, imported:null, reviews:{}, history:[]};
    if (!value || typeof value !== 'object' || value.version !== 1) return safe;
    if (value.imported && Array.isArray(value.imported.pages) && value.imported.pages.length > 0 && value.imported.pages.length <= 5000) {
      const pages = value.imported.pages;
      const valid = pages.every(p => p && validUrl(p.url) && ['clicks','impressions','ctr','position'].every(k => typeof p[k] === 'number' && Number.isFinite(p[k]) && p[k] >= 0) && Number.isSafeInteger(p.clicks) && Number.isSafeInteger(p.impressions) && p.clicks <= p.impressions && p.ctr <= 100 && p.position <= 1000);
      if (valid && new Set(pages.map(p => p.url)).size === pages.length) safe.imported = {pages:pages.map(p => ({url:p.url,clicks:p.clicks,impressions:p.impressions,ctr:p.ctr,position:p.position})), filename:String(value.imported.filename || 'Search Console CSV').slice(0,200), date:String(value.imported.date || '').slice(0,100)};
    }
    if (value.reviews && typeof value.reviews === 'object' && !Array.isArray(value.reviews)) {
      Object.entries(value.reviews).slice(0,10000).forEach(([id, r]) => {
        if (id === '__proto__' || id === 'constructor' || id === 'prototype' || !r || !['approved','dismissed'].includes(r.status)) return;
        if (typeof r.title !== 'string' || typeof r.description !== 'string' || typeof r.date !== 'string') return;
        safe.reviews[id] = {status:r.status,title:r.title.slice(0,150),description:r.description.slice(0,400),date:r.date.slice(0,100),url:typeof r.url === 'string' && validUrl(r.url) ? r.url : '', name:String(r.name || 'Page').slice(0,200)};
      });
    }
    if (Array.isArray(value.history)) safe.history = value.history.filter(x => x && typeof x.id === 'string' && ['approved','dismissed','undone'].includes(x.action) && typeof x.date === 'string' && typeof x.name === 'string').map(x => ({id:x.id.slice(0,3000),action:x.action,date:x.date.slice(0,100),name:x.name.slice(0,200),url:validUrl(x.url) ? x.url : ''}));
    return safe;
  }
  return {escape, validUrl, parseCsv, totals, validateState, sampleAuditSource};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SummitData;

if (typeof document !== 'undefined') (() => {
  const {escape:esc, parseCsv, totals, validateState} = SummitData;
  const STATIC_DEMO = document.documentElement.dataset.hosting === 'static-demo';
  const STORAGE_KEY = 'summit-workspace-v1';
  const demoPages = [
    {id:'hiking',name:'The best hiking boots for every trail',url:'https://summitoutdoors.com/blog/best-hiking-boots',type:'Improve page title',priority:'high',clicks:1284,impressions:48210,ctr:2.7,position:8.2,title:'Best Hiking Boots for Every Trail | Summit Outdoors',description:'Find your next pair of hiking boots. Compare our trail-tested picks for comfort, grip, and support, from easy day hikes to demanding mountain routes.',reason:'This page earns plenty of impressions, but its click-through rate is below the demo site average. A clearer, more specific title could help searchers see its value.'},
    {id:'packs',name:'Find your perfect hiking backpack',url:'https://summitoutdoors.com/collections/hiking-backpacks',type:'Refine meta description',priority:'high',clicks:962,impressions:36480,ctr:2.6,position:11.3,title:'Hiking Backpacks for Day Trips & Multi-Day Treks | Summit',description:'Explore comfortable hiking backpacks for every adventure. Find the right fit, capacity, and trail-ready features for day hikes and multi-day trips.',reason:'The sample description does not explain what makes this collection useful. Help visitors choose by mentioning fit, capacity, and trip length.'},
    {id:'camping',name:'Your complete camping essentials checklist',url:'https://summitoutdoors.com/blog/camping-essentials',type:'Improve page title',priority:'medium',clicks:856,impressions:24300,ctr:3.5,position:9.6,title:'Camping Essentials: A Practical Packing Checklist | Summit',description:'Pack with confidence. Our practical camping checklist covers shelter, sleeping gear, cooking equipment, and the small essentials that make a trip easier.',reason:'Give searchers a clear reason to click. A focused title that explains the format and benefit is easier to understand at a glance.'},
    {id:'jackets',name:'Weather-ready outdoor jackets',url:'https://summitoutdoors.com/collections/outdoor-jackets',type:'Refine meta description',priority:'medium',clicks:714,impressions:19800,ctr:3.6,position:14.8,title:'Outdoor Jackets for Changing Conditions | Summit Outdoors',description:'Get ready for changing conditions. Explore waterproof shells, insulated layers, and lightweight outdoor jackets for your next adventure.',reason:'The example search snippet can do more to describe this collection. Mentioning the available types of jackets helps visitors decide whether the page is relevant.'},
    {id:'trails',name:'A beginner’s guide to reading trail maps',url:'https://summitoutdoors.com/blog/reading-trail-maps',type:'Improve page title',priority:'low',clicks:412,impressions:8600,ctr:4.8,position:16.5,title:'How to Read a Trail Map: A Beginner’s Guide | Summit',description:'Learn the basics of trail maps, including contour lines, trail markers, and route planning, so you can head outside with more confidence.',reason:'A how-to title matches this guide’s educational purpose. Keep the wording useful and natural while making the subject immediately clear.'},
    {id:'tents',name:'Make more room for the outdoors',url:'https://summitoutdoors.com/collections/camping-tents',type:'Refine meta description',priority:'low',clicks:588,impressions:12140,ctr:4.8,position:13.9,title:'Camping Tents for Weekend Adventures | Summit Outdoors',description:'Find a comfortable place to camp. Browse camping tents in a range of sizes and compare weather protection, weight, and easy setup.',reason:'This example description can make product choices clearer. Describe the collection in terms visitors use when comparing tents.'}
  ];
  const paths = {
    overview:'<rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/>',
    spark:'<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z"/><path d="m20 2 .6 1.4L22 4l-1.4.6L20 6l-.6-1.4L18 4l1.4-.6L20 2Z"/>',
    audit:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    history:'<path d="M3 10a9 9 0 1 1 1.5 7M3 4v6h6M12 7v5l3 2"/>',
    plug:'<path d="m9 15 6-6M8 4 5 7a4 4 0 0 0 0 6l1 1m10 6 3-3a4 4 0 0 0 0-6l-1-1M3 3l3 3m15 15-3-3M9 3l3 3M3 9l3 3m15 3-3-3m-3 9-3-3"/>',
    globe:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    down:'<path d="m8 10 4 4 4-4"/>',
    arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',
    up:'<path d="M5 16 16 5M6 5h10v10"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/>',
    download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
    click:'<path d="m5 3 3 17 4-6 7-2L5 3Zm7 11 5 6"/>',
    eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    percent:'<path d="m5 19 14-14"/><circle cx="6.5" cy="6.5" r="3"/><circle cx="17.5" cy="17.5" r="3"/>',
    chart:'<path d="M4 3v17h17M8 15l4-5 4 2 5-6"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    checkCircle:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
    warning:'<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3h.01"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    upload:'<path d="M12 16V3m-4 4 4-4 4 4M4 15v6h16v-6"/>',
    code:'<path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/>',
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
    undo:'<path d="m3 9 4-4M3 9l4 4M3 9h11a6 6 0 0 1 0 12h-3"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    settings:'<path d="m9 3-1 3-3 1v4l-2 1 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-1V7l-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>'
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.info}</svg>`;
  const mark = '<svg class="brand-mark" viewBox="0 0 38 38" aria-hidden="true"><path fill="currentColor" d="m2 30 16-25 18 25H25L18 19l-7 11Z"/><path fill="#657b56" d="m18 19 4 6-4 5h-7Z"/></svg>';
  const format = number => new Intl.NumberFormat('en-US').format(number);
  const compact = number => number >= 1000 ? `${Number((number / 1000).toFixed(number >= 100000 ? 0 : 1))}k` : format(number);
  const safeDate = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}); };
  let state, storageWarning = false;
  try { state = validateState(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch { state = validateState(null); storageWarning = true; }
  let view = ['overview','opportunities','audit','history','connections'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  let range = 28, search = '', priority = 'all', auditResult = null, auditInput = '', auditError = '', auditBusy = false, importError = '', mobileOpen = false, activeReview = null, previousFocus = null, toastTimer;
  const app = document.getElementById('app'), overlayRoot = document.getElementById('overlay-root');
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); storageWarning = false; return true; }
    catch { storageWarning = true; toast('Browser storage is unavailable. Export your work before closing this tab.'); return false; }
  }
  function getPages() {
    if (!state.imported) return demoPages;
    return state.imported.pages.map((page, i) => {
      const url = new URL(page.url), path = decodeURIComponentSafe(url.pathname).replace(/\/$/,'');
      const segment = path.split('/').filter(Boolean).pop() || url.hostname;
      const name = segment.replace(/[-_]/g,' ').replace(/\.[a-z0-9]{2,5}$/i,'').replace(/^./,x => x.toUpperCase()).slice(0,150);
      return {...page,id:`import:${page.url}`,name,type:'Review search snippet',priority:page.impressions >= 1000 && page.ctr < 3 ? 'high' : page.position > 5 && page.position <= 20 ? 'medium' : 'low',title:name,description:'',reason:'This page comes from your imported Search Console metrics. The CSV does not include its current title or description. Check the live page, then write an accurate search snippet below.'};
    }).sort((a,b) => b.impressions-a.impressions);
  }
  function decodeURIComponentSafe(text) { try { return decodeURIComponent(text); } catch { return text; } }
  function pendingPages() { return getPages().filter(page => !state.reviews[page.id]); }
  function siteName() { if (!state.imported) return 'summitoutdoors.com'; const hosts = [...new Set(state.imported.pages.map(page => new URL(page.url).hostname))]; return hosts.length === 1 ? hosts[0] : 'Imported pages'; }
  function setView(next, focusSearch = false) {
    closeOverlay(false); view = next; mobileOpen = false; location.hash = next; render();
    if (focusSearch) document.getElementById('opportunity-search')?.focus(); else document.getElementById('main')?.focus({preventScroll:true});
  }
  function toast(message, undoId) {
    const el = document.getElementById('toast'); clearTimeout(toastTimer);
    el.innerHTML = `<span>${esc(message)}</span>${undoId ? `<button type="button" data-action="undo" data-id="${esc(undoId)}">Undo</button>` : ''}`;
    el.classList.add('visible'); toastTimer = setTimeout(() => el.classList.remove('visible'), undoId ? 9000 : 6000);
  }
  const pageTitles = {overview:'Overview',opportunities:'Opportunities',audit:'Site audit',history:'Change history',connections:'Connections'};
  function sidebar() {
    const pending = pendingPages().length;
    return `<div class="mobile-shade ${mobileOpen?'open':''}" data-action="close-menu"></div><aside class="sidebar ${mobileOpen?'open':''}" aria-label="Main navigation"><a class="brand" href="#overview" aria-label="Summit overview">${mark}<span>SUMMIT</span></a><button class="workspace" type="button" data-nav="connections" aria-label="Manage workspace connections"><span class="site-avatar">${esc(siteName()[0].toUpperCase())}</span><span><span class="workspace-label">Your workspace</span><span class="workspace-name" style="display:block;max-width:125px;overflow:hidden;text-overflow:ellipsis">${esc(siteName())}</span></span>${icon('down')}</button><div class="nav-label">WORKSPACE</div><nav class="nav">${[['overview','overview'],['opportunities','spark'],['audit','audit'],['history','history'],['connections','plug']].map(([key,symbol])=>`<button type="button" class="${view===key?'active':''}" data-nav="${key}" ${view===key?'aria-current="page"':''}>${icon(symbol)}<span>${pageTitles[key]}</span>${key==='opportunities'&&pending?`<span class="nav-count">${pending}</span>`:''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="summit-note"><svg class="ridge" viewBox="0 0 114 44" fill="none" aria-hidden="true"><path d="m1 42 24-27 14 13L60 3l30 34 14-13 9 9M17 42l16-18m9 18L60 20l19 22M29 35l9 7M60 3v8M50 15l10-4 14 8" stroke="currentColor" stroke-width="1"/></svg><div class="eyebrow">Small steps. Higher ground.</div><p>A little clarity goes a long way.</p></div><div class="profile"><div class="avatar">${state.imported?'YW':'SO'}</div><div><strong>${state.imported?'Your workspace':'Summit Outdoors'}</strong><p>Local workspace</p></div>${icon('globe')}</div></div></aside>`;
  }
  function render() {
    app.innerHTML = `${sidebar()}<div class="app-body"><header class="topbar"><div class="topbar-left"><button type="button" class="icon-button mobile-toggle" data-action="toggle-menu" aria-label="Open navigation" aria-expanded="${mobileOpen}">${icon('menu')}</button><div class="breadcrumb">${icon('globe')}<span>Workspace</span><span class="divider">/</span><strong>${pageTitles[view]}</strong></div></div><div class="top-actions"><span class="demo-tag">${state.imported?'Imported workspace':'Demo workspace'}</span><button type="button" class="icon-button" data-action="search" aria-label="Search opportunities">${icon('search')}</button></div></header><main class="main" id="main" tabindex="-1">${storageWarning?'<div class="notice warning">Browser storage is unavailable. Export your work to keep a copy.</div>':''}${({overview:overview,opportunities:opportunities,audit:audit,history:history,connections:connections}[view])()}<footer class="app-footer"><span>${state.imported?'Your imported data. Your next step.':'A little clarity. A little progress. Every day.'}</span><span class="engine"><i class="engine-dot"></i> ${STATIC_DEMO?'Unison app · interactive preview':'Powered by Unison'}</span></footer></main></div>`;
    bindViewInputs();
  }
  function overview() {
    return `<div class="page-heading"><div><h1>Your search, in focus.</h1><p>A clearer view of what’s working. A confident next step.</p></div><div class="heading-actions"><button type="button" class="button" data-action="export">${icon('download')}Export report</button></div></div>${metrics()}<div class="performance-grid">${performance()}${nextMove()}</div><section aria-labelledby="opportunities-heading"><div class="section-heading"><div><div class="title-line"><h2 id="opportunities-heading">Opportunities worth your attention</h2><span class="count-badge">${pendingPages().length}</span></div><p>A few focused improvements can make a difference.</p></div><button type="button" class="text-button" data-nav="opportunities">View all ${icon('arrow')}</button></div>${opportunityTable(pendingPages().slice(0,4),false)}</section>`;
  }
  function metrics() {
    const imported = !!state.imported;
    const data = imported ? totals(state.imported.pages) : range === 28 ? {clicks:24800,impressions:482000,ctr:5.1,position:12.4} : {clicks:71600,impressions:1420000,ctr:5.0,position:13.1};
    const metricData = [['Total clicks',compact(data.clicks),'click','18.6%'],['Total impressions',data.impressions>=1000000?`${(data.impressions/1000000).toFixed(2)}m`:compact(data.impressions),'eye','24.2%'],['Average CTR',`${data.ctr.toFixed(1)}%`,'percent','0.8%'],['Average position',data.position.toFixed(1),'chart','3.2']];
    return `<section class="metrics" aria-label="Search performance metrics">${metricData.map(([label,value,symbol,trend])=>`<article class="metric"><div class="metric-title"><span>${label}</span>${icon(symbol)}</div><div class="metric-value">${value}</div><div class="metric-footer">${imported?`<span>${label==='Average position'?'Weighted by impressions':'From imported page totals'}</span>`:`<span class="trend">${icon('up')}${trend}</span><span>vs. previous ${range} days</span>`}</div></article>`).join('')}</section>`;
  }
  function chartSvg() {
    const values = range===28 ? [35,35,44,41,29,32,38,44,39,43,50,44,55,46,48,57,62,53,58,61,57,67,74,69,74,78,72,88] : [18,22,28,20,24,33,29,35,39,33,42,38,46,43,52,45,53,50,61,56,68,62,67,78,70,82,76,91];
    const old = range===28 ? [26,28,24,29,25,26,32,29,35,29,33,31,38,32,37,35,41,36,42,39,44,40,48,43,48,46,50,49] : [15,18,14,20,17,22,26,21,28,24,31,28,35,31,38,34,40,36,42,39,46,41,47,43,50,48,55,51];
    const points = array => array.map((v,i)=>[47+i*653/(array.length-1),192-v*1.58]);
    const smoothPath = array => { const p=points(array);return p.map(([x,y],i)=>i===0?`M${x.toFixed(1)} ${y.toFixed(1)}`:`C${(p[i-1][0]+12).toFixed(1)} ${p[i-1][1].toFixed(1)},${(x-12).toFixed(1)} ${y.toFixed(1)},${x.toFixed(1)} ${y.toFixed(1)}`).join(' '); };
    const line = smoothPath(values), previous = smoothPath(old), labels = range===28?['Oct 12','Oct 16','Oct 20','Oct 24','Oct 28','Nov 1','Nov 8']:['Aug 11','Aug 25','Sep 9','Sep 24','Oct 9','Oct 24','Nov 8'];
    return `<svg class="chart" viewBox="0 0 730 230" role="img" aria-label="Demo clicks over ${range} days, trending upward compared with the previous period"><defs><linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#b8eb9b" stop-opacity=".17"/><stop offset="100%" stop-color="#b8eb9b" stop-opacity="0"/></linearGradient></defs>${[28,80,132,184].map((y,i)=>`<line class="gridline" x1="47" y1="${y}" x2="700" y2="${y}"/><text x="29" y="${y+4}" text-anchor="end">${['1.5k','1k','500','0'][i]}</text>`).join('')}<path d="${line}L700 192L47 192Z" fill="url(#area-fill)"/><path d="${previous}" fill="none" stroke="#617454" stroke-width="1.6" stroke-dasharray="5 5"/><path d="${line}" fill="none" stroke="#b8eb9b" stroke-width="2.7" stroke-linecap="round"/>${labels.map((label,i)=>`<text x="${47+i*653/6}" y="219" text-anchor="${i===0?'start':i===6?'end':'middle'}">${label}</text>`).join('')}<circle cx="700" cy="${points(values).at(-1)[1]}" r="4" fill="#b8eb9b" stroke="#243021" stroke-width="3"/></svg>`;
  }
  function performance() {
    if (state.imported) return `<section class="panel performance" aria-labelledby="performance-heading"><div class="panel-header"><div><h2 id="performance-heading">Your search performance</h2><p>${format(state.imported.pages.length)} pages · ${esc(state.imported.filename)}</p></div><span class="status-pill">Imported data</span></div><div class="imported-chart"><div class="empty-state compact"><div class="empty-icon">${icon('chart')}</div><h3>Your page totals are ready.</h3><p>This CSV contains page totals, so a daily trend isn’t available. Explore your pages below to find the next improvement.</p></div></div><div class="chart-foot"><span>${icon('info')}No date range or trend inferred from page data</span><span>Local CSV import</span></div></section>`;
    return `<section class="panel performance" aria-labelledby="performance-heading"><div class="panel-header"><div><h2 id="performance-heading">Your search performance</h2><p>Every visit starts with a little visibility.</p></div><div class="segment" aria-label="Chart date range"><button type="button" data-range="28" class="${range===28?'active':''}" aria-pressed="${range===28}">28 days</button><button type="button" data-range="90" class="${range===90?'active':''}" aria-pressed="${range===90}">90 days</button></div></div><div class="legend"><span><i></i>Clicks</span><span><i class="previous"></i>Previous period</span></div><div class="chart-wrap">${chartSvg()}</div><div class="chart-foot"><span>${icon('info')}Illustrative sample data · Nov 8, 2026</span><span>Google Search Console preview ${icon('arrow')}</span></div></section>`;
  }
  function nextMove() {
    const next = pendingPages()[0];
    if (!next) return `<aside class="panel next-move"><div class="next-move-top"><span class="eyebrow">ROOM TO GROW</span><span class="spark-box">${icon('check')}</span></div><h2>A clear path ahead.</h2><p>You’ve reviewed every opportunity in this workspace. Audit another page to find your next improvement.</p><div class="opportunity-fact">${icon('checkCircle')}Your review queue is clear</div><button type="button" class="button primary" data-nav="audit">Audit a page ${icon('arrow')}</button></aside>`;
    return `<aside class="panel next-move"><div class="next-move-top"><span class="eyebrow">YOUR NEXT MOVE</span><span class="spark-box">${icon('spark')}</span></div><h2>Turn impressions<br>into visits.</h2><p>${state.imported?'Start with a page people are already seeing. Review its search snippet to make the next step clearer.':next.id==='hiking'?'Your hiking boots guide is getting noticed. A sharper title could help more people take the next step.':`“${esc(next.name)}” is getting noticed. A clearer search snippet could help more people take the next step.`}</p><div class="opportunity-fact">${icon('eye')}${format(next.impressions)} impressions · ${next.ctr.toFixed(1)}% CTR</div><button type="button" class="button primary" data-review="${esc(next.id)}">Review suggestion ${icon('arrow')}</button></aside>`;
  }
  function opportunityRows(pages) {
    if (!pages.length) return '<tr><td colspan="6"><div class="empty-state compact"><h3>No opportunities here.</h3><p>Try another search or filter. Reviewed pages appear in Change history.</p></div></td></tr>';
    return pages.map(page=>`<tr><td class="page-cell"><div class="page-name">${esc(page.name)}</div><div class="page-url">${esc(new URL(page.url).pathname)}</div></td><td><span class="opportunity-type">${icon(page.type.includes('title')?'audit':'spark')}${esc(page.type)}</span></td><td class="numeric">${format(page.clicks)}</td><td class="numeric">${format(page.impressions)}</td><td><span class="priority ${page.priority}">${page.priority[0].toUpperCase()+page.priority.slice(1)}</span></td><td><button type="button" class="row-action" data-review="${esc(page.id)}" aria-label="Review ${esc(page.name)}">${icon('arrow')}</button></td></tr>`).join('');
  }
  function filteredPages() { const q=search.toLowerCase(); return pendingPages().filter(page=>(priority==='all'||page.priority===priority)&&`${page.name} ${page.url} ${page.type}`.toLowerCase().includes(q)); }
  function opportunityTable(pages, filters) {
    return `<div class="panel table-panel">${filters?`<div class="table-toolbar"><div class="search-field">${icon('search')}<input id="opportunity-search" type="search" placeholder="Search pages or opportunities…" value="${esc(search)}" aria-label="Search opportunities"></div><select id="priority-filter" class="filter-select" aria-label="Filter by priority">${[['all','All priorities'],['high','High priority'],['medium','Medium priority'],['low','Low priority']].map(([value,label])=>`<option value="${value}" ${priority===value?'selected':''}>${label}</option>`).join('')}</select></div>`:''}<div class="table-scroll"><table><thead><tr><th scope="col">PAGE</th><th scope="col">OPPORTUNITY</th><th scope="col">CLICKS</th><th scope="col">IMPRESSIONS</th><th scope="col">PRIORITY</th><th scope="col"><span class="visually-hidden">Review</span></th></tr></thead><tbody id="opportunity-rows">${opportunityRows(pages)}</tbody></table></div><div class="table-footer"><span id="opportunity-count">Showing ${pages.length} of ${pendingPages().length} opportunities</span><span>${state.imported?'Imported page metrics':'Sample workspace data'}</span></div></div>`;
  }
  function opportunities() { return `<div class="page-heading"><div><h1>A little focus goes a long way.</h1><p>Review the pages with room to grow, one thoughtful change at a time.</p></div><button type="button" class="button" data-action="export">${icon('download')}Export report</button></div>${state.imported?`<div class="notice">${icon('info')}<span>Priorities use imported impressions, CTR, and position. Titles and descriptions need your review against each live page.</span></div>`:''}${opportunityTable(filteredPages(),true)}`; }
  function audit() {
    if(STATIC_DEMO)return sampleAudit();
    return `<div class="page-heading"><div><h1>Give your next page a head start.</h1><p>A focused check of the essentials, powered by Unison.</p></div>${auditResult?`<button type="button" class="button" data-action="export">${icon('download')}Export report</button>`:''}</div><div class="notice">${icon('info')}<span>Analyze the HTML you provide. Summit checks page markup; it doesn’t crawl a website or execute scripts.</span></div><div class="audit-grid"><section class="panel form-panel"><h2>Start with your page HTML</h2><p>Paste the full source of a page, or choose an HTML file.</p><form id="audit-form"><div class="field"><label for="html-input">Page source <span class="field-note">Up to 500 KB</span></label><textarea class="code-input" id="html-input" placeholder="<!doctype html>\n<html lang=&quot;en&quot;>\n  <head>\n    <title>Your next great page</title>\n  </head>\n  <body>…</body>\n</html>" spellcheck="false" required>${esc(auditInput)}</textarea></div><div class="form-actions"><label class="button file-label" for="html-file">${icon('upload')}Choose HTML file<input class="visually-hidden" id="html-file" type="file" accept=".html,.htm,text/html"></label><button type="submit" class="button primary" ${auditBusy?'disabled':''}>${icon('audit')}${auditBusy?'Analyzing…':'Analyze page'}</button></div><p id="audit-error" class="error-message" role="alert">${esc(auditError)}</p></form></section><section class="panel audit-result" aria-live="polite">${auditResult?auditResults():`<div class="empty-state"><div class="empty-icon">${icon('audit')}</div><h3>Clarity starts here.</h3><p>See how your page handles titles, descriptions, headings, images, and search visibility.</p><span class="status-pill">7 essential checks · Real page evidence</span></div>`}</section></div>`;
  }
  function sampleAudit() {
    return `<div class="page-heading"><div><h1>See the essentials in action.</h1><p>A real Unison audit, saved for this interactive preview.</p></div>${auditResult?`<button type="button" class="button" data-action="export">${icon('download')}Export report</button>`:''}</div><div class="notice shared-demo-notice">${icon('info')}<span><strong>Shared demo · Custom HTML audits run in the local Unison app.</strong><span>This preview displays a saved result for the example below. Your own HTML is not analyzed here.</span></span></div><div class="audit-grid"><section class="panel form-panel"><h2>Example page source</h2><p>This sample includes one image without alt text. Its report was generated by the real Unison audit engine.</p><div class="field"><label for="sample-html">Example HTML <span class="field-note">Read only</span></label><textarea class="code-input" id="sample-html" readonly spellcheck="false">${esc(SummitData.sampleAuditSource)}</textarea></div><div class="form-actions"><span class="field-note">Saved sample · No live analysis</span><button type="button" class="button primary" data-action="view-sample-audit" ${auditBusy?'disabled':''}>${icon('audit')}${auditBusy?'Loading sample…':'View sample audit'}</button></div><p id="audit-error" class="error-message" role="alert">${esc(auditError)}</p></section><section class="panel audit-result" aria-live="polite">${auditResult?auditResults():`<div class="empty-state"><div class="empty-icon">${icon('audit')}</div><h3>A closer look at a sample page.</h3><p>Open the saved report to explore the seven checks, the checklist score, and a concrete improvement.</p><span class="status-pill">Saved Unison sample</span></div>`}</section></div>`;
  }
  function auditResults() {
    const r = auditResult;
    return `<h2>${STATIC_DEMO?'Sample audit results':'Your page, at a glance'}</h2>${STATIC_DEMO?'<p class="sample-result-note">Saved report for the example HTML shown here.</p>':''}<div class="audit-score"><div class="score-ring" style="--score:${Math.max(0,Math.min(100,r.score))}"><strong>${esc(r.score)}</strong></div><div><h3>${r.score>=85?'A strong foundation.':r.score>=60?'Some room to improve.':'A few essentials need attention.'}</h3><p>Checklist score out of 100.<br>Not a prediction of search rankings.</p></div></div><div class="audit-counts"><div><strong>${esc(r.h1Count)}</strong><span>H1 headings</span></div><div><strong>${esc(r.imageCount)}</strong><span>Images</span></div><div><strong>${esc(r.missingAlt)}</strong><span>Missing alt text</span></div></div>${r.checks.map(check=>`<div class="check ${check.status}">${icon(check.status==='pass'?'checkCircle':check.status==='warning'?'info':'warning')}<div><strong>${esc(check.label)}</strong><p>${esc(check.detail)}</p></div><span class="check-status">${check.status}</span></div>`).join('')}`;
  }
  function history() {
    const items = state.history.slice().reverse();
    return `<div class="page-heading"><div><h1>Good progress leaves a trail.</h1><p>Your decisions, all in one place. Every saved approval stays local.</p></div><button type="button" class="button" data-action="export">${icon('download')}Export report</button></div><div class="notice">${icon('info')}<span>Approvals are saved proposals. No changes are published to your website. Export the report to hand them off for implementation.</span></div><section class="panel">${items.length?`<div class="history-list">${items.map((item,index)=>{const latest=items.find(x=>x.id===item.id)===item;return `<article class="history-item ${item.action}"><div class="history-icon">${icon(item.action==='approved'?'check':item.action==='undone'?'undo':'close')}</div><div class="history-body"><strong>${item.action==='approved'?'Approved suggestion':item.action==='dismissed'?'Dismissed suggestion':'Restored to opportunities'} · ${esc(item.name)}</strong><p>${esc(item.url)}</p><div class="history-date">${esc(safeDate(item.date))} · Saved in this browser</div></div>${latest&&state.reviews[item.id]?`<button type="button" class="button ghost" data-action="undo" data-id="${esc(item.id)}">${icon('undo')}Undo</button>`:''}</article>`;}).join('')}</div>`:`<div class="empty-state"><div class="empty-icon">${icon('history')}</div><h3>Your next step starts a story.</h3><p>Approve or dismiss an opportunity to begin your change history. You can undo a decision whenever you need to.</p><button type="button" class="button primary" data-nav="opportunities">Explore opportunities ${icon('arrow')}</button></div>`}</section>`;
  }
  function connections() {
    return `<div class="page-heading"><div><h1>Bring your work together.</h1><p>Start with your own data. Keep control of every change.</p></div></div><section class="connections-grid" aria-label="Integration status">${[['G','Google Search Console','Use a Search Console Pages CSV to bring real clicks, impressions, and rankings into your workspace.','CSV import available below'],['W','WordPress','Review and export proposed titles and descriptions for your WordPress site.','Live publishing is not configured'],[icon('code'),'GitHub','Export approved changes as JSON for your development workflow.','Repository access is not configured']].map(([logo,name,description,note])=>`<article class="panel connection-card"><div class="connection-heading"><span class="provider-logo">${logo}</span><span class="status-pill">Disconnected</span></div><h3>${name}</h3><p>${description}</p><div class="connection-note">${note}</div></article>`).join('')}</section><section class="panel import-panel"><div><span class="eyebrow">MAKE IT YOURS</span><h2 style="font-size:23px;margin-top:11px">Your data. A clearer direction.</h2><p>Import the Pages table from a Search Console performance report. Your page totals and opportunities will replace the demo data.</p><p class="import-help">Required columns: <strong>Page</strong> (or <strong>Top pages</strong>), <strong>Clicks</strong>, <strong>Impressions</strong>, <strong>CTR</strong>, <strong>Position</strong>. Up to 5,000 pages, 2 MB. Dates and trends are not inferred.</p><button type="button" class="text-button" data-action="sample-csv">Download a CSV template ${icon('download')}</button></div><div><div class="upload-zone">${icon('upload')}<h3>Bring your page metrics</h3><p>A Search Console Pages export in .csv format</p><label class="button primary file-label" for="csv-file">Choose CSV file<input id="csv-file" class="visually-hidden" type="file" accept=".csv,text/csv"></label>${state.imported?`<p style="margin-bottom:0">${esc(state.imported.filename)} · ${format(state.imported.pages.length)} pages imported</p>`:''}</div><p id="import-error" class="error-message" role="alert">${esc(importError)}</p></div></section><section class="panel workspace-tools"><div><h3>Your local workspace</h3><p>Reviews and imports are saved in this browser. Export a copy to keep or share.</p></div><div class="heading-actions"><button type="button" class="button" data-action="export">${icon('download')}Export workspace</button><button type="button" class="button ghost danger-button" data-action="reset-dialog">Reset workspace</button></div></section>`;
  }
  function bindViewInputs() {
    document.getElementById('opportunity-search')?.addEventListener('input',event=>{search=event.target.value;updateTable();});
    document.getElementById('priority-filter')?.addEventListener('change',event=>{priority=event.target.value;updateTable();});
    document.getElementById('html-input')?.addEventListener('input',event=>{
      auditInput=event.target.value;auditError='';
      if(auditResult){auditResult=null;const resultPanel=document.querySelector('.audit-result');if(resultPanel)resultPanel.innerHTML='<div class="empty-state"><div class="empty-icon">'+icon('audit')+'</div><h3>Ready for a fresh look.</h3><p>The source has changed. Analyze this HTML to see checks for the updated page.</p></div>';document.querySelector('.page-heading [data-action="export"]')?.remove();}
      const error=document.getElementById('audit-error');if(error)error.textContent='';
    });
    document.getElementById('audit-form')?.addEventListener('submit',runAudit);
    document.getElementById('html-file')?.addEventListener('change',readHtml);
    document.getElementById('csv-file')?.addEventListener('change',importCsv);
  }
  function updateTable() { const pages=filteredPages();document.getElementById('opportunity-rows').innerHTML=opportunityRows(pages);document.getElementById('opportunity-count').textContent=`Showing ${pages.length} of ${pendingPages().length} opportunities`; }
  async function readHtml(event) {
    const file=event.target.files[0]; if(!file)return;
    auditResult=null;auditError='';
    if(file.size>500_000){auditError='Choose an HTML file smaller than 500 KB.';render();return;}
    try {auditInput=await file.text();auditResult=null;auditError='';render();toast(`Loaded ${file.name}. Ready to analyze.`);}catch{auditError='This file could not be read. Try choosing it again.';render();}
  }
  async function runAudit(event) {
    event.preventDefault(); if(STATIC_DEMO||auditBusy)return;
    auditInput=document.getElementById('html-input').value;auditResult=null;
    if(!auditInput.trim()){auditError='Paste some HTML or choose a file first.';render();return;}
    if(new TextEncoder().encode(auditInput).length>500_000){auditError='Keep the page source below 500 KB.';render();return;}
    const submittedSource=auditInput;
    auditBusy=true;auditError='';render();
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
    try {
      const response=await fetch('./api/analyze',{method:'POST',headers:{'Content-Type':'text/html; charset=utf-8'},body:auditInput,signal:controller.signal});
      if(!response.ok)throw new Error(response.status===413?'This HTML is too large for the audit service.':'The audit service could not analyze this page. Please try again.');
      const result=await response.json();
      if(!validAuditResult(result))throw new Error('The audit service returned an unexpected response.');
      if(auditInput===submittedSource){auditResult=result;toast('Audit complete. Your page checks are ready.');}
      else toast('The source changed. Analyze the updated HTML to see its results.');
    }catch(error){if(auditInput===submittedSource)auditError=error.name==='AbortError'?'The audit timed out. Check that the Unison server is running, then try again.':error instanceof TypeError?'Could not reach the Unison audit service. Check that the local server is running.':error.message;}
    finally{clearTimeout(timeout);auditBusy=false;if(view==='audit')render();}
  }
  function validAuditResult(result) {
    return result && ['score','h1Count','imageCount','missingAlt'].every(k=>typeof result[k]==='number'&&Number.isFinite(result[k])&&result[k]>=0) && result.score<=100 && Array.isArray(result.checks) && result.checks.every(c=>c&&['pass','warning','fail'].includes(c.status)&&typeof c.label==='string'&&typeof c.detail==='string');
  }
  async function viewSampleAudit() {
    if(!STATIC_DEMO||auditBusy)return;
    auditBusy=true;auditError='';auditResult=null;render();
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
    try {
      const response=await fetch('./sample-audit.json',{signal:controller.signal});
      if(!response.ok)throw new Error('The saved sample audit could not be loaded. Please try again.');
      const result=await response.json();
      if(!validAuditResult(result))throw new Error('The saved sample audit has an unexpected format.');
      auditResult=result;toast('Saved Unison sample loaded. No custom HTML was analyzed.');
    }catch(error){auditError=error.name==='AbortError'?'The sample report took too long to load. Please try again.':error instanceof TypeError?'Could not load the saved sample. Check your connection and try again.':error.message;}
    finally{clearTimeout(timeout);auditBusy=false;if(view==='audit')render();}
  }
  async function importCsv(event) {
    const file=event.target.files[0];if(!file)return;
    importError='';
    try {
      if(file.size>2_000_000)throw new Error('Choose a CSV smaller than 2 MB.');
      const pages=parseCsv(await file.text());
      state.imported={pages,filename:file.name,date:new Date().toISOString()};search='';priority='all';persist();render();toast(`Imported ${format(pages.length)} pages. Your workspace now uses your data.`);
    }catch(error){importError=error.message;render();}
  }
  function openReview(id) {
    const page=getPages().find(p=>p.id===id);if(!page)return;
    previousFocus=document.activeElement;activeReview=id;document.body.style.overflow='hidden';
    overlayRoot.innerHTML=`<div class="overlay" data-action="close-overlay"><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="review-title"><header class="drawer-header"><div><div class="eyebrow">A THOUGHTFUL NEXT STEP</div><h2 id="review-title">${esc(page.type)}</h2></div><button type="button" class="icon-button" data-action="close-overlay" aria-label="Close review">${icon('close')}</button></header><div class="drawer-body"><span class="priority ${page.priority}">${page.priority[0].toUpperCase()+page.priority.slice(1)} priority</span><p class="drawer-url">${esc(page.url)}</p><div class="recommendation"><div class="eyebrow">WHY THIS IS WORTH A LOOK</div><p>${esc(page.reason)}</p></div><form id="review-form"><div class="field"><label for="proposed-title">Proposed page title <span class="field-note" id="title-length">${page.title.length} characters</span></label><input id="proposed-title" type="text" value="${esc(page.title)}" maxlength="150" required><p class="field-note">Aim for a clear, specific title. Around 50–60 characters is a useful starting point.</p></div><div class="field"><label for="proposed-description">Proposed meta description <span class="field-note" id="description-length">${page.description.length} characters</span></label><textarea id="proposed-description" rows="4" maxlength="400" required placeholder="Write a helpful, accurate summary of this page…">${esc(page.description)}</textarea></div><p id="review-error" class="error-message" role="alert"></p><div class="preview-label">SEARCH PREVIEW</div><div class="search-preview"><div class="search-preview-domain"><span class="site-avatar">${esc(new URL(page.url).hostname[0].toUpperCase())}</span><span>${esc(new URL(page.url).hostname)}<br><small>${esc(new URL(page.url).pathname)}</small></span></div><div class="search-preview-title" id="preview-title">${esc(page.title)}</div><div class="search-preview-description" id="preview-description">${esc(page.description)||'Your description will appear here as you write.'}</div></div><p class="preview-note">Illustrative preview. Search engines may display different text.</p></form></div><footer class="drawer-footer"><div class="form-actions"><button type="button" class="button ghost" data-action="dismiss-review">Dismiss suggestion</button><button type="submit" form="review-form" class="button primary">${icon('check')}Save approval</button></div><p>Saved locally for review. Nothing is published to your website.</p></footer></section></div>`;
    document.getElementById('proposed-title').addEventListener('input',updatePreview);document.getElementById('proposed-description').addEventListener('input',updatePreview);
    document.getElementById('review-form').addEventListener('submit',event=>{event.preventDefault();saveReview('approved');});
    document.getElementById('proposed-title').focus();
  }
  function updatePreview() {
    const title=document.getElementById('proposed-title').value, description=document.getElementById('proposed-description').value;
    document.getElementById('preview-title').textContent=title||'Your page title';document.getElementById('preview-description').textContent=description||'Your description will appear here as you write.';
    document.getElementById('title-length').textContent=`${title.length} characters`;document.getElementById('description-length').textContent=`${description.length} characters`;
  }
  function saveReview(status) {
    const page=getPages().find(p=>p.id===activeReview);if(!page)return;
    const title=document.getElementById('proposed-title').value.trim(),description=document.getElementById('proposed-description').value.trim();
    if(status==='approved'&&(!title||!description)){document.getElementById('review-error').textContent='Add both a title and a description before saving your approval.';return;}
    const date=new Date().toISOString();state.reviews[page.id]={status,title,description,date,url:page.url,name:page.name};state.history.push({id:page.id,action:status,date,url:page.url,name:page.name});
    const saved=persist();closeOverlay(false);render();document.getElementById('main').focus({preventScroll:true});toast(saved?(status==='approved'?'Approval saved locally. Nothing has been published.':'Suggestion dismissed.'): 'Saved for this session only. Export your work to keep it.',page.id);
  }
  function undo(id) {
    const review=state.reviews[id];if(!review)return;
    state.history.push({id,action:'undone',date:new Date().toISOString(),name:review.name,url:review.url});delete state.reviews[id];persist();render();toast('Decision undone. The page is back in opportunities.');
  }
  function closeOverlay(restore=true) {overlayRoot.innerHTML='';document.body.style.overflow='';activeReview=null;if(restore&&previousFocus?.isConnected)previousFocus.focus();previousFocus=null;}
  function resetDialog() {
    previousFocus=document.activeElement;document.body.style.overflow='hidden';
    overlayRoot.innerHTML=`<div class="overlay" data-action="close-overlay"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="reset-title"><h2 id="reset-title">Start with a fresh workspace?</h2><p>This removes imported metrics and saved review decisions from this browser, then restores the demo workspace. Export a report first if you’d like to keep a copy.</p><div class="form-actions"><button type="button" class="button ghost" data-action="close-overlay" id="cancel-reset">Keep workspace</button><button type="button" class="button danger-button" data-action="confirm-reset">Reset workspace</button></div></section></div>`;
    document.getElementById('cancel-reset').focus();
  }
  function download(filename,content,type) {const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function exportReport() {
    const report={app:'Summit SEO',exportedAt:new Date().toISOString(),source:state.imported?'Imported Search Console page metrics':'Illustrative demo data',site:siteName(),metrics:state.imported?totals(state.imported.pages):{clicks:range===28?24800:71600,impressions:range===28?482000:1420000,ctr:range===28?5.1:5.0,position:range===28?12.4:13.1},import:state.imported,reviews:state.reviews,history:state.history,audit:auditResult,auditSource:auditResult?(STATIC_DEMO?'Saved Unison report for the built-in example HTML':'User-provided HTML analyzed by the local Unison app'):null,hosting:STATIC_DEMO?'static-demo':'local',notice:'Review decisions are local proposals. No changes have been published.'};
    download(`summit-report-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(report,null,2),'application/json');toast('Report exported, including your local review decisions.');
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-nav],[data-action],[data-range],[data-review]');if(!button)return;
    if(button.dataset.nav){setView(button.dataset.nav);return;}
    if(button.dataset.range){range=Number(button.dataset.range);render();document.querySelector(`[data-range="${range}"]`)?.focus({preventScroll:true});return;}
    if(button.dataset.review){openReview(button.dataset.review);return;}
    const action=button.dataset.action;
    if(action==='close-overlay'){if(button.classList.contains('overlay')&&event.target!==button)return;closeOverlay();return;}
    if(action==='search')setView('opportunities',true);
    if(action==='export')exportReport();
    if(action==='view-sample-audit')viewSampleAudit();
    if(action==='dismiss-review')saveReview('dismissed');
    if(action==='undo')undo(button.dataset.id);
    if(action==='toggle-menu'||action==='close-menu'){mobileOpen=action==='toggle-menu'?!mobileOpen:false;render();}
    if(action==='reset-dialog')resetDialog();
    if(action==='confirm-reset'){state=validateState(null);auditResult=null;auditInput='';auditError='';importError='';search='';priority='all';range=28;persist();closeOverlay(false);render();toast('Demo workspace restored.');}
    if(action==='sample-csv'){download('summit-search-console-template.csv','Page,Clicks,Impressions,CTR,Position\r\nhttps://example.com/your-page,120,4000,3%,8.4\r\n','text/csv');toast('Template downloaded. Replace the sample row with your metrics.');}
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){if(overlayRoot.firstChild)closeOverlay();else if(mobileOpen){mobileOpen=false;render();document.querySelector('.mobile-toggle')?.focus();}}
    if(event.key==='Tab'&&overlayRoot.firstChild){const elements=[...overlayRoot.querySelectorAll('button:not([disabled]),input,textarea,select,a[href],[tabindex="0"]')];const first=elements[0],last=elements.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
  });
  window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);if(Object.hasOwn(pageTitles,next)&&next!==view){view=next;mobileOpen=false;closeOverlay(false);render();}});
  render();
})();
