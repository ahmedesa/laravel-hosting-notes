const fs=require('fs'),path=require('path');const {marked}=require('marked');
const SRC=path.join(__dirname,'articles'),OUT=path.join(__dirname,'dist');
const SITE='Laravel Hosting Notes';const BASE_URL='https://ahmedesa.github.io/laravel-hosting-notes/',BASE='/laravel-hosting-notes';const fix=h=>h.replace(/(href|src)="\/(?!\/)/g,`$1="${BASE}/`);const URLS=[];
const LINKS={HOSTINGER:['hostinger','https://www.hostinger.com/vps-hosting'],CLOUDWAYS:['cloudways','https://www.cloudways.com/'],DIGITALOCEAN:['digitalocean','https://www.digitalocean.com/'],PLOI:['ploi','https://ploi.io/']};
const SECTION={'best-hosting-for-laravel':'reviews','deploy-laravel-hostinger-vps':'tutorials','forge-vs-ploi-vs-cloudways':'compare'};
const noDash=s=>s.replace(/\s+—\s+/g,', ').replace(/—/g,', ').replace(/–/g,'-');
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const DISC=`<aside class="disclosure"><strong>Affiliate disclosure:</strong> some links in this article are affiliate links. If you sign up through them I may earn a commission at no extra cost to you. It doesn't change what I recommend, and I list the downsides too. <a href="/disclosure/">More details</a>.</aside>`;
function page(title,desc,body,url){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="stylesheet" href="/style.css"></head><body><header><a class="brand" href="/">${SITE}</a><nav><a href="/">Articles</a><a href="/about/">About</a></nav></header><main>${body}</main><footer><p>&copy; 2026 Ahmed Esa · <a href="/about/">About</a> · <a href="/privacy/">Privacy</a> · <a href="/disclosure/">Affiliate disclosure</a></p></footer></body></html>`}
function write(rel,html){const f=path.join(OUT,rel,'index.html');fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,fix(html));URLS.push(rel)}
fs.rmSync(OUT,{recursive:true,force:true});fs.mkdirSync(OUT);fs.copyFileSync(path.join(__dirname,'style.css'),path.join(OUT,'style.css'));
const posts=[];
for(const file of fs.readdirSync(SRC).filter(f=>f.endsWith('.md'))){
 let raw=fs.readFileSync(path.join(SRC,file),'utf8');
 const m=raw.match(/^---\n([\s\S]*?)\n---\n/);const fm={};m[1].split('\n').forEach(l=>{const i=l.indexOf(':');fm[l.slice(0,i).trim()]=l.slice(i+1).trim().replace(/^"|"$/g,'')});
 let md=raw.slice(m[0].length).replace(/^# .*\n/m,'').replace(/^> \*\*Disclosure:\*\*.*\n/m,'');
 md=noDash(md);
 let html=marked.parse(md);
 html=html.replace(/<a href="(?:\{\{|%7B%7B)(\w+)_LINK(?:\}\}|%7D%7D)">/g,(_,k)=>{const [p,u]=LINKS[k];return `<!-- AFFILIATE:${p} --><a href="${u}" rel="sponsored noopener" target="_blank">`});
 html=html.replace(/href="(\/(?:reviews|tutorials|compare)\/[\w-]+)"/g,'href="$1/"');
 if(/\{\{|%7B%7B/.test(html))throw new Error('unreplaced placeholder in '+file);
 const title=noDash(fm.title),desc=noDash(fm.description),url=`/${SECTION[fm.slug]||'posts'}/${fm.slug}/`;
 posts.push({title,desc,url});
 write(url,page(`${title} | ${SITE}`,desc,`<article><p class="meta">By Ahmed Esa</p><h1>${esc(title)}</h1>${DISC}${html}</article>`));
}
write('',page(SITE,'Practical notes on hosting and deploying Laravel apps, by Ahmed Esa.',`<h1>${SITE}</h1><p class="lead">Notes from a PHP/Laravel backend developer on where to host Laravel apps and how to deploy them without surprises.</p><ul class="posts">${posts.map(p=>`<li><a href="${p.url}">${esc(p.title)}</a><p>${esc(p.desc)}</p></li>`).join('')}</ul>`));
for(const n of ['about','privacy','disclosure']){const [t,d,b]=require('./pages/'+n+'.js');write(n,page(`${t} | ${SITE}`,d,`<article><h1>${t}</h1>${b}</article>`))}
fs.writeFileSync(path.join(OUT,'404.html'),fix(page('Not found',"Page not found",'<h1>Page not found</h1><p><a href="/">Back to the articles</a>.</p>')));
const loc=r=>BASE_URL+String(r).replace(/^\/+/,'').replace(/([^/])$/,'$1/');
fs.writeFileSync(path.join(OUT,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${URLS.map(r=>`<url><loc>${loc(r)}</loc></url>`).join('\n')}\n</urlset>\n`);
fs.writeFileSync(path.join(OUT,'robots.txt'),`User-agent: *\nAllow: /\n\nSitemap: ${BASE_URL}sitemap.xml\n`);
fs.writeFileSync(path.join(OUT,'.nojekyll'),'');
console.log('built',posts.map(p=>p.url));
