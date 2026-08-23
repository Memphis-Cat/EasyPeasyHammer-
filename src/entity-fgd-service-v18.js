// byanca
'use strict';

const fs = require('fs');
const path = require('path');

const MAX_FGD_FILES = 220;
const MAX_FGD_BYTES = 6 * 1024 * 1024;

const safeJson = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
function normalizeRoot(candidate) {
  if (!candidate) return null;
  try {
    let root = path.resolve(String(candidate).trim().replace(/^"|"$/g, ''));
    if (path.basename(root).toLowerCase() === 'csgo') root = path.resolve(root, '..', '..');
    else if (path.basename(root).toLowerCase() === 'game') root = path.resolve(root, '..');
    return fs.existsSync(path.join(root, 'game', 'csgo', 'gameinfo.gi')) ? root : null;
  } catch { return null; }
}
function steamRoots() {
  const out = [];
  const installs = [path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam')];
  for (const steam of installs) {
    out.push(path.join(steam, 'steamapps', 'common', 'Counter-Strike Global Offensive'));
    const libraries = path.join(steam, 'steamapps', 'libraryfolders.vdf');
    try {
      const text = fs.readFileSync(libraries, 'utf8');
      for (const match of text.matchAll(/"path"\s*"([^"]+)"/gi)) out.push(path.join(match[1].replace(/\\\\/g, '\\'), 'steamapps', 'common', 'Counter-Strike Global Offensive'));
    } catch {}
  }
  return out;
}
function findCs2Root(app) {
  const config = safeJson(path.join(app.getPath('userData'), 'asset-config.json'), {});
  for (const candidate of [config?.cs2Root, process.env.EPH_CS2_PATH, ...steamRoots()]) { const root = normalizeRoot(candidate); if (root) return root; }
  return null;
}
function collectFgds(folder, out, depth = 0) {
  if (!folder || depth > 4 || out.length >= MAX_FGD_FILES) return;
  let entries = [];
  try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (out.length >= MAX_FGD_FILES) break;
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      if (!['maps','models','materials','sounds','panorama','scripts','resource'].includes(entry.name.toLowerCase())) collectFgds(file, out, depth + 1);
    } else if (entry.isFile() && /\.fgd$/i.test(entry.name)) {
      try { if (fs.statSync(file).size <= MAX_FGD_BYTES) out.push(file); } catch {}
    }
  }
}
function stripComment(line) {
  let quoted = false, escaped = false;
  for (let i = 0; i < line.length - 1; i++) {
    const c = line[i];
    if (escaped) { escaped = false; continue; }
    if (quoted && c === '\\') { escaped = true; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (!quoted && c === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}
function delta(text, open, close) {
  let d = 0, quoted = false, escaped = false;
  for (const c of String(text || '')) {
    if (escaped) { escaped = false; continue; }
    if (quoted && c === '\\') { escaped = true; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (c === open) d++; else if (c === close) d--;
  }
  return d;
}
function numbers(text) { return [...String(text || '').matchAll(/-?(?:\d+(?:\.\d*)?|\.\d+)/g)].map(x => Number(x[0])).filter(Number.isFinite); }
function unquote(value) {
  const text = String(value ?? '').trim();
  return text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\') : text;
}
function titleFromClass(value) { return String(value || '').split('_').filter(Boolean).map(x => x.charAt(0).toUpperCase() + x.slice(1)).join(' '); }
function splitColons(text) {
  const out = []; let current = '', quoted = false, escaped = false, round = 0, square = 0, curly = 0;
  for (const c of String(text || '')) {
    if (escaped) { current += c; escaped = false; continue; }
    if (quoted && c === '\\') { current += c; escaped = true; continue; }
    if (c === '"') { quoted = !quoted; current += c; continue; }
    if (!quoted) {
      if (c === '(') round++; else if (c === ')') round = Math.max(0, round - 1);
      else if (c === '[') square++; else if (c === ']') square = Math.max(0, square - 1);
      else if (c === '{') curly++; else if (c === '}') curly = Math.max(0, curly - 1);
      else if (c === ':' && !round && !square && !curly) { out.push(current.trim()); current = ''; continue; }
    }
    current += c;
  }
  out.push(current.trim()); return out;
}
function topLevelIndex(text, wanted) {
  let quoted=false, escaped=false, round=0, square=0, curly=0;
  for (let i=0;i<String(text||'').length;i++) {
    const c=text[i];
    if (escaped) { escaped=false; continue; }
    if (quoted && c==='\\') { escaped=true; continue; }
    if (c==='"') { quoted=!quoted; continue; }
    if (quoted) continue;
    if (c==='(') round++; else if (c===')') round=Math.max(0,round-1);
    else if (c==='[') square++; else if (c===']') square=Math.max(0,square-1);
    else if (c==='{') curly++; else if (c==='}') curly=Math.max(0,curly-1);
    else if (c===wanted && !round && !square && !curly) return i;
  }
  return -1;
}
function matchingBlock(text, start) {
  const open=text[start], close=open==='['?']':open==='{'?'}':null; if(!close)return -1;
  let depth=0, quoted=false, escaped=false;
  for(let i=start;i<text.length;i++) {
    const c=text[i];
    if(escaped){escaped=false;continue;}
    if(quoted&&c==='\\'){escaped=true;continue;}
    if(c==='"'){quoted=!quoted;continue;}
    if(quoted)continue;
    if(c===open)depth++; else if(c===close&&--depth===0)return i;
  }
  return -1;
}
function stripLeadingAttributes(text) {
  let value=String(text||'').trim();
  for(let guard=0;guard<12;guard++) {
    if(!value.startsWith('[')&&!value.startsWith('{')) return { complete:true, text:value };
    const end=matchingBlock(value,0); if(end<0)return { complete:false, text:value };
    value=value.slice(end+1).trim();
  }
  return { complete:true, text:value };
}
function classAssignment(text) {
  const source=String(text||''); let quoted=false,escaped=false,round=0,square=0,curly=0;
  for(let i=0;i<source.length;i++) {
    const c=source[i];
    if(escaped){escaped=false;continue;}
    if(quoted&&c==='\\'){escaped=true;continue;}
    if(c==='"'){quoted=!quoted;continue;}
    if(quoted)continue;
    if(c==='(')round++; else if(c===')')round=Math.max(0,round-1);
    else if(c==='[')square++; else if(c===']')square=Math.max(0,square-1);
    else if(c==='{')curly++; else if(c==='}')curly=Math.max(0,curly-1);
    else if(c==='='&&!round&&!square&&!curly) {
      const match=source.slice(i+1).match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*"([^"]*)")?/);
      if(match)return { className:match[1], description:match[2]||'', index:i };
    }
  }
  return null;
}
function helperCalls(header) {
  const helpers = [];
  const pattern = /\b(editormodel|studio|iconsprite|sprite|size|bbox|wirebox|sphere|cylinder|line|light|frustum|decal|quadbounds|path|origin|arc_range)\s*(?:\(([^)]*)\)|\{([^}]*)\})/gi;
  for (const match of header.matchAll(pattern)) helpers.push({ type: match[1].toLowerCase(), raw: (match[2] ?? match[3] ?? '').trim() });
  return helpers;
}
function renderHints(header) {
  const helpers = helperCalls(header);
  const colorValues = numbers(header.match(/\bcolor\s*\(([^)]*)\)/i)?.[1] || '');
  const color = colorValues.length >= 3 ? colorValues.slice(0, 3) : null;
  const result = [];
  for (const helper of helpers) {
    const quoted = helper.raw.match(/"([^"]+)"/)?.[1] || '';
    if (['editormodel','studio'].includes(helper.type)) {
      let resource = quoted.replace(/\\/g, '/');
      if (resource && !/\.[a-z0-9]+$/i.test(resource)) resource += '.vmdl';
      result.push({ type: helper.type, resource, color, fixedBounds: /\bfixedbounds\b/i.test(helper.raw) });
      continue;
    }
    if (['iconsprite','sprite'].includes(helper.type)) { result.push({ type: helper.type, resource: quoted.replace(/\\/g, '/'), color }); continue; }
    if (['size','bbox','wirebox'].includes(helper.type)) {
      const n = numbers(helper.raw); let bounds = null;
      if (n.length >= 6) bounds = { min: n.slice(0,3), max: n.slice(3,6) };
      else if (n.length >= 3) { const half = n.slice(0,3).map(v => Math.abs(v) / 2); bounds = { min: half.map(v => -v), max: half }; }
      result.push({ type: helper.type === 'size' ? 'bbox' : helper.type, bounds, color }); continue;
    }
    result.push({ type: helper.type, args: helper.raw, numbers: numbers(helper.raw), color });
  }
  return result;
}
function metadata(header) {
  return {
    name: header.match(/\bentity_tool_name\s*=\s*"([^"]+)"/i)?.[1] || '',
    tip: header.match(/\bentity_tool_tip\s*=\s*"([^"]+)"/i)?.[1] || '',
    group: header.match(/\bentity_tool_group\s*=\s*"([^"]+)"/i)?.[1] || ''
  };
}
function collectPropertyHeader(lines, start, type) {
  let joined='';
  for(let i=start;i<Math.min(lines.length,start+40);i++) {
    const line=stripComment(lines[i]).trim(); if(!line)continue;
    joined+=`${joined?' ':''}${line}`;
    const close=joined.indexOf(')'); if(close<0)continue;
    const stripped=stripLeadingAttributes(joined.slice(close+1)); if(!stripped.complete)continue;
    const rest=stripped.text;
    const eq=topLevelIndex(rest,'=');
    if(/\b(?:choices|flags)\b/i.test(type)) {
      if(eq>=0)return { end:i, rest, beforeEquals:rest.slice(0,eq).trim() };
      continue;
    }
    if(rest.startsWith(':')) return { end:i, rest, beforeEquals:eq>=0?rest.slice(0,eq).trim():rest };
  }
  return null;
}
function choiceBlock(lines, headerEnd) {
  let text='', began=false, depth=0, end=headerEnd;
  for(let i=headerEnd;i<Math.min(lines.length,headerEnd+260);i++) {
    let line=stripComment(lines[i]);
    if(i===headerEnd) {
      const eq=topLevelIndex(line,'=');
      line=eq>=0?line.slice(eq+1):'';
    }
    if(!began) {
      const at=line.indexOf('['); if(at<0)continue;
      began=true; line=line.slice(at+1); depth=1;
    }
    let segment=line;
    const closeAt=(()=>{let q=false,e=false,d=depth;for(let x=0;x<line.length;x++){const c=line[x];if(e){e=false;continue;}if(q&&c==='\\'){e=true;continue;}if(c==='"'){q=!q;continue;}if(q)continue;if(c==='[')d++;else if(c===']'){d--;if(d===0)return x;}}return -1;})();
    if(closeAt>=0){segment=line.slice(0,closeAt);depth=0;} else depth+=delta(line,'[',']');
    text+=`${text?'\n':''}${segment}`; end=i;
    if(began&&depth<=0)break;
  }
  const choices=[];
  const regex=/(?:^|\n)\s*(?:"((?:\\.|[^"])*)"|([^:\r\n]+?))\s*:\s*"((?:\\.|[^"])*)"(?:\s*:\s*([^\r\n]+?))?\s*(?=\n|$)/gm;
  for(const match of text.matchAll(regex)) choices.push({ value:unquote(match[1]??match[2]??''), label:String(match[3]||'').replace(/\\"/g,'"'), default:unquote(match[4]||'') });
  return { choices, end };
}
function parseProperties(blockLines) {
  const properties=[]; let squareDepth=1, curlyDepth=0;
  for(let i=0;i<blockLines.length;i++) {
    const line=stripComment(blockLines[i]).trim();
    const beforeSquare=squareDepth, beforeCurly=curlyDepth;
    const squareChange=delta(line,'[',']'), curlyChange=delta(line,'{','}');
    if(line&&beforeSquare===1&&beforeCurly===0&&!/^(?:input|output)\b/i.test(line)) {
      const start=line.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*\(\s*([^)]*)\)/);
      if(start) {
        const key=start[1], type=start[2].trim(), header=collectPropertyHeader(blockLines,i,type);
        if(header) {
          const clean=header.beforeEquals.replace(/^\s*:\s*/,'');
          const parts=clean?splitColons(clean):[];
          const joined=blockLines.slice(i,header.end+1).join(' ');
          const close=joined.indexOf(')'); const attr=close>=0?joined.slice(close+1):'';
          let choices=[]; let choiceEnd=header.end;
          if(/\b(?:choices|flags)\b/i.test(type)) { const parsed=choiceBlock(blockLines,header.end); choices=parsed.choices; choiceEnd=parsed.end; }
          let defaultValue=unquote(parts[1]||'');
          if(/\bflags\b/i.test(type)&&!defaultValue&&choices.length) {
            let mask=0; for(const choice of choices) if(/^(?:1|true|yes)$/i.test(String(choice.default||''))&&Number.isFinite(Number(choice.value))) mask|=Number(choice.value); defaultValue=String(mask);
          }
          properties.push({ key, type, label:unquote(parts[0]||key)||key, default:defaultValue, description:unquote(parts.slice(2).join(':')||''), group:attr.match(/\bgroup\s*=\s*"([^"]+)"/i)?.[1]||'', choices });
          // Do not jump the outer loop: walking each physical line keeps the
          // nesting depth correct for multiline metadata and choice blocks.
          void choiceEnd;
        }
      }
    }
    squareDepth+=squareChange; curlyDepth+=curlyChange;
    if(squareDepth<=0)break;
  }
  const byKey=new Map(); for(const property of properties)byKey.set(property.key.toLowerCase(),property); return [...byKey.values()];
}
function parseDeclarations(text, sourceFile) {
  const lines=String(text||'').split(/\r?\n/).map(stripComment), out=[];
  for(let i=0;i<lines.length;i++) {
    const first=lines[i].trim(), kindMatch=first.match(/^@(PointClass|SolidClass|BaseClass|OverrideClass|ExtendClass)\b/i); if(!kindMatch)continue;
    const headerLines=[first]; let cursor=i, blockStart=-1, curlyDepth=delta(first,'{','}'), assignment=classAssignment(first);
    while(++cursor<lines.length&&cursor<i+300) {
      const line=lines[cursor].trim(); if(!line)continue;
      if(curlyDepth===0&&/^@(PointClass|SolidClass|BaseClass|OverrideClass|ExtendClass)\b/i.test(line)&&!assignment)break;
      const candidate=`${headerLines.join(' ')} ${line}`, found=classAssignment(candidate);
      if(curlyDepth===0&&found&&/^\[/.test(line)){blockStart=cursor;assignment=found;break;}
      headerLines.push(line); curlyDepth+=delta(line,'{','}'); assignment=found||assignment;
    }
    const header=headerLines.join(' '); assignment=classAssignment(header)||assignment; if(!assignment)continue;
    const helpers=renderHints(header), meta=metadata(header), base=header.match(/\bbase\s*\(([^)]*)\)/i)?.[1]?.split(',').map(x=>x.trim()).filter(Boolean)||[];
    const block=[];
    if(blockStart>=0){let d=0;for(let j=blockStart;j<lines.length;j++){const line=lines[j];d+=delta(line,'[',']');if(j>blockStart)block.push(line);if(d<=0&&j>blockStart){cursor=j;break;}}i=Math.max(i,cursor);}
    const kindText=kindMatch[1].toLowerCase(), primary=helpers.find(h=>['editormodel','studio'].includes(h.type))||helpers.find(h=>['iconsprite','sprite'].includes(h.type))||helpers.find(h=>h.bounds)||helpers[0]||{type:'none'};
    out.push({ className:assignment.className, name:meta.name||assignment.description?.trim()||titleFromClass(assignment.className), description:meta.tip||assignment.description?.trim()||'', group:meta.group||'', kind:kindText==='solidclass'?'solid':kindText==='pointclass'?'point':kindText==='baseclass'?'base':'extend', baseClasses:base, model:['editormodel','studio'].includes(primary.type)?primary.resource||'':'', renderHint:primary, renderHints:helpers, properties:parseProperties(block), sourceFile });
  }
  return out;
}
function merge(map,declaration) {
  const key=declaration.className.toLowerCase(), old=map.get(key); if(!old)return void map.set(key,declaration);
  const props=new Map((old.properties||[]).map(p=>[p.key.toLowerCase(),p]));for(const p of declaration.properties||[])props.set(p.key.toLowerCase(),p);
  map.set(key,{...old,...declaration,kind:declaration.kind==='extend'?old.kind:declaration.kind,name:declaration.name||old.name,description:declaration.description||old.description,group:declaration.group||old.group,baseClasses:[...new Set([...(old.baseClasses||[]),...(declaration.baseClasses||[])])],model:declaration.model||old.model||'',renderHint:declaration.renderHint?.type!=='none'?declaration.renderHint:old.renderHint,renderHints:[...(old.renderHints||[]),...(declaration.renderHints||[])],properties:[...props.values()]});
}
function resolve(name,all,memo,stack=new Set()) {
  const key=String(name||'').toLowerCase(); if(memo.has(key))return memo.get(key);const own=all.get(key);if(!own||stack.has(key))return own||null;stack.add(key);
  const props=new Map(),helpers=[];let model='',hint=null;
  for(const baseName of own.baseClasses||[]){const base=resolve(baseName,all,memo,stack);if(!base)continue;for(const p of base.properties||[])props.set(p.key.toLowerCase(),p);helpers.push(...(base.renderHints||[]));model||=base.model||'';if(!hint&&base.renderHint?.type!=='none')hint=base.renderHint;}
  for(const p of own.properties||[])props.set(p.key.toLowerCase(),p);helpers.push(...(own.renderHints||[]));
  const value={...own,model:own.model||model,renderHint:own.renderHint?.type!=='none'?own.renderHint:hint||own.renderHint,renderHints:helpers,properties:[...props.values()]};stack.delete(key);memo.set(key,value);return value;
}
function catalogForInstall(app) {
  const root=findCs2Root(app);if(!root)return{ok:false,error:'CS2 installation not configured.',entities:[]};
  const files=[];for(const folder of[path.join(root,'game','csgo'),path.join(root,'game','core'),path.join(root,'game','sdktools')])collectFgds(folder,files);
  const all=new Map();let parseErrors=0;
  for(const file of files){try{const rel=path.relative(root,file).replace(/\\/g,'/');for(const declaration of parseDeclarations(fs.readFileSync(file,'utf8'),rel))merge(all,declaration);}catch(error){parseErrors++;globalThis.__ephAppLog?.('warning','fgd',`Could not parse ${file}`,error);}}
  const memo=new Map(),entities=[...all.keys()].map(k=>resolve(k,all,memo)).filter(x=>x&&['point','solid'].includes(x.kind)&&x.className!=='worldspawn').sort((a,b)=>a.name.localeCompare(b.name)||a.className.localeCompare(b.className));
  const pointEntities=entities.filter(x=>x.kind==='point').length,solidEntities=entities.filter(x=>x.kind==='solid').length;
  globalThis.__ephAppLog?.('normal','fgd',`Hammer FGD catalog built: ${entities.length} entities from ${files.length} files`,{point:pointEntities,solid:solidEntities,parseErrors});
  return{ok:true,root,fgdFiles:files.length,parseErrors,pointEntities,solidEntities,entities};
}
function registerEntityFgdServiceV18({ipcMain,app}) {
  if(globalThis.__ephEntityFgdServiceV18)return;globalThis.__ephEntityFgdServiceV18=true;try{ipcMain.removeHandler('entities:fgd-catalog');}catch{}
  let cache=null,time=0;ipcMain.handle('entities:fgd-catalog',()=>{if(!cache||Date.now()-time>60000){cache=catalogForInstall(app);time=Date.now();}return cache;});
}
module.exports={registerEntityFgdServiceV18,catalogForInstall,parseDeclarations};
