/* =====================================================================
   改行の点検ツール（サイトには読み込まれません／確認用）

   使い方：ローカルサーバを立て、同じオリジンの適当なページを開いて

     const s=document.createElement('script');
     s.src='/tools/lbaudit.js'; document.head.appendChild(s);
     await window.__one('story.html');     // 12通りの画面幅で before/after を数える

   「変な改行」の数え方は assets/js/main.js の「改行の見張り」と同じ。
   ?lb=off を付けたページが見張りなし、付けないページが見張りありです。
   ===================================================================== */
/* 検証用（公開には含めない）: 変な改行の数を、幅を変えながら数える */
window.__lines = function (doc, el, cs, lh) {
  var rg = doc.createRange(); rg.selectNodeContents(el);
  var rects = rg.getClientRects(), out = [], i, j, r, hit;
  for (i = 0; i < rects.length; i++) { r = rects[i]; if (!r.height || !r.width) continue; hit = null;
    for (j = 0; j < out.length; j++) { if (Math.abs(r.top - out[j].top) < lh * 0.55) { hit = out[j]; break; } }
    if (hit) { if (r.right > hit.right) hit.right = r.right; if (r.left < hit.left) hit.left = r.left; }
    else out.push({ top: r.top, left: r.left, right: r.right }); }
  out.sort(function (a, b) { return a.top - b.top; }); return out;
};
window.__inlineOnly = function (win, el) {
  var INLINE={A:1,ABBR:1,B:1,BDI:1,BR:1,CITE:1,CODE:1,EM:1,I:1,MARK:1,Q:1,S:1,SMALL:1,SPAN:1,STRONG:1,SUB:1,SUP:1,TIME:1,U:1,WBR:1};
  for (var i = 0; i < el.children.length; i++) { var c = el.children[i];
    if (!INLINE[c.tagName]) return false;
    if (c.tagName !== 'BR' && c.tagName !== 'WBR') { var d = win.getComputedStyle(c).display;
      if (d !== 'contents' && d !== 'ruby' && d.indexOf('inline') !== 0) return false; }
    if (!window.__inlineOnly(win, c)) return false; }
  return true;
};
window.__audit = function (doc, win) {
  var HEAD={H1:1,H2:1,H3:1,H4:1,H5:1,H6:1,SUMMARY:1,DT:1};
  var els=[].slice.call(doc.querySelectorAll('p, li, dd, dt, figcaption, blockquote, h1,h2,h3,h4,h5,h6, summary, .eyebrow'));
  var early=0, orphan=0, over=0, sev=0, mx=0, worst=[], split=[];
  els.forEach(function (el) {
    if (!el.textContent.trim() || el.closest('.honeypot')) return;
    if (!window.__inlineOnly(win, el)) return;
    var cs=win.getComputedStyle(el);
    if (cs.textAlign==='center'||cs.textAlign==='right'||cs.textAlign==='end') return;
    if (/balance|pretty/.test(cs.textWrap||cs.textWrapStyle||'')) return;
    if (/^pre/.test(cs.whiteSpace)||cs.whiteSpace==='nowrap') return;
    var box=el.getBoundingClientRect(); if (!box.width||!box.height) return;
    var sc=el.offsetWidth? box.width/el.offsetWidth : 1; if (!sc||!isFinite(sc)) sc=1;
    var em=(parseFloat(cs.fontSize)||16)*sc;
    var right=box.right-(parseFloat(cs.paddingRight)||0)*sc-(parseFloat(cs.borderRightWidth)||0)*sc;
    var left=box.left+(parseFloat(cs.paddingLeft)||0)*sc+(parseFloat(cs.borderLeftWidth)||0)*sc;
    var lh=(parseFloat(cs.lineHeight)||em*1.6);
    var L=window.__lines(doc, el, cs, lh);
    if (L.length<2) return;
    var width=right-left; if (width<=0) return;
    var head=HEAD[el.tagName]===1||el.classList.contains('eyebrow')||cs.wordBreak==='keep-all';
    var tol=head?Math.max(2.5,width*0.18/em):Math.max(1.4,width*0.04/em);
    var brs=el.getElementsByTagName('br'), forced=[];
    for (var bi=0;bi<brs.length;bi++){ var b=brs[bi].getBoundingClientRect(); if (b.height||b.top) forced.push(b.top); }
    for (var k=0;k<L.length-1;k++) {
      var skip=false; for (var fi=0;fi<forced.length;fi++){ if (Math.abs(forced[fi]-L[k].top)<lh*0.55){skip=true;break;} }
      if (skip) continue;
      var gap=(right-L[k].right)/em;
      if (gap>tol){ early++; sev+=Math.pow(gap-tol,1.5); if(gap>mx)mx=gap;
        worst.push({g:Math.round(gap*10)/10,t:el.textContent.replace(/⁠/g,'').replace(/\s+/g,' ').slice(0,24),tag:el.tagName,cls:(el.className||'').slice(0,20)}); } }
    var lastw=(L[L.length-1].right-L[L.length-1].left)/em;
    if (lastw<1.6) orphan++;
    if (el.scrollWidth>el.clientWidth+2) over++;
    /* 人名などの「切ってはいけない語」が行をまたいでいないか */
    [].slice.call(el.querySelectorAll('.nw')).forEach(function (n) {
      var nl=window.__lines(doc, n, win.getComputedStyle(n), lh);
      if (nl.length>1) split.push(n.textContent.slice(0,14));
    });
  });
  worst.sort(function (a,b) { return b.g-a.g; });
  return {'早':early,'ひどさ':Math.round(sev*10)/10,'最大':Math.round(mx*10)/10,'泣':orphan,'はみ':over,'語の分断':split.length,'例':worst.slice(0,3)};
};
window.__sweep = async function (page, off, widths) {
  var f=document.createElement('iframe');
  f.style.cssText='position:fixed;left:-99999px;top:0;height:1200px;border:0';
  f.style.width=widths[0]+'px'; document.body.appendChild(f);
  f.src='/'+page+(off?'?lb=off':'?lb=on');
  await new Promise(function (r) { f.onload=r; setTimeout(r,10000); });
  var d=f.contentDocument, w=f.contentWindow;
  try { await d.fonts.ready; } catch (e) {}
  d.querySelectorAll('[data-reveal]').forEach(function (e) { e.classList.add('is-visible'); });
  await new Promise(function (r) { setTimeout(r,1000); });
  var out={};
  for (var i=0;i<widths.length;i++) {
    f.style.width=widths[i]+'px';
    d.querySelectorAll('[data-reveal]').forEach(function (e) { e.classList.add('is-visible'); });
    await new Promise(function (r) { setTimeout(r,560); });
    out[widths[i]]=window.__audit(d,w);
  }
  f.remove(); return out;
};
window.__W=[320,360,390,430,480,560,640,768,900,1024,1180,1440];
window.__res={};
window.__one = async function (p) {
  var off=await window.__sweep(p, true, window.__W), on=await window.__sweep(p, false, window.__W);
  window.__res[p]={off:off,on:on};
  var A=0,B=0,SA=0,SB=0,OA=0,OB=0,ov=0,MA=0,MB=0,SP=0;
  window.__W.forEach(function (w) { A+=off[w]['早'];B+=on[w]['早'];SA+=off[w]['ひどさ'];SB+=on[w]['ひどさ'];
    OA+=off[w]['泣'];OB+=on[w]['泣'];ov+=on[w]['はみ'];SP+=on[w]['語の分断'];
    MA=Math.max(MA,off[w]['最大']);MB=Math.max(MB,on[w]['最大']); });
  return p+': 早すぎ '+A+'→'+B+' / ひどさ '+Math.round(SA)+'→'+Math.round(SB)+' / 最大 '+MA+'→'+MB+'字 / 1字残り '+OA+'→'+OB+' / はみ出し '+ov+' / 語の分断 '+SP;
};
'ready';
