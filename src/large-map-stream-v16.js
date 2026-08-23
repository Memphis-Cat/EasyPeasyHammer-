// byanca
(() => {
  'use strict';
  if (window.__ephLargeMapStreamV16) return;
  window.__ephLargeMapStreamV16 = true;

  const api = window.easyPeasyHammer, VMAP = window.EPH_VMAP, THREE = window.THREE;
  if (!api || !VMAP || !THREE) return;

  const st = { active:false, token:null, entries:[], byId:new Map(), byDmx:new Map(), loaded:new Map(), pending:new Set(), bounds:new Map(), hidden:new Map(), refresh:null, tree:null, pumping:false, rawSet:null, rawSave:null, rawUi:null };
  const BATCH = 8, UNLOAD_MS = 650, REFRESH_MS = 90, MAX_RESIDENT = 900, OCCLUSION_NEAR = 28;
  const vec = (v, d=[0,0,0]) => Array.isArray(v) ? d.map((x,i)=>Number.isFinite(Number(v[i]))?Number(v[i]):x) : [...d];

  function proxy(entry) {
    const dmx = entry.dmxId || entry.entryId, cls = String(entry.className || 'info_target');
    return ensureObject({ id:`entity:${dmx}`, dmxId:dmx, type:cls.startsWith('prop_')&&entry.model?'prop':'entity', sourceClass:'CMapEntity', name:entry.targetname||entry.label||cls, className:cls, model:entry.model||'', position:vec(entry.position), rotation:vec(entry.rotation), scale:vec(entry.scale,[1,1,1]), size:[64,64,64], visible:entry.visible!==false, collision:true, entityProperties:{}, parent:'world', ephLargeEntryId:entry.entryId, ephLargeProxy:true });
  }

  function worldPosition(entry) {
    const p=vec(entry?.position); let id=entry?.parentEntryId, guard=0;
    while(id&&guard++<12){const parent=st.byId.get(id);if(!parent)break;const q=vec(parent.position);p[0]+=q[0];p[1]+=q[1];p[2]+=q[2];id=parent.parentEntryId;}
    return p;
  }
  function containerEntry(entry) {
    let cur=entry, guard=0;
    while(cur?.parentEntryId&&guard++<12){const parent=st.byId.get(cur.parentEntryId);if(!parent)break;if(parent.type==='entity')return parent;cur=parent;}
    return entry;
  }
  function distance(entry){const c=S.viewport?.camera;if(!c)return Infinity;return c.position.distanceTo(new THREE.Vector3(...worldPosition(entry)));}
  function sphere(entry){const objectId=st.loaded.get(entry.entryId), cached=objectId&&st.bounds.get(objectId);if(cached)return new THREE.Sphere(new THREE.Vector3(...cached.c),cached.r);const scale=vec(entry.scale,[1,1,1]);return new THREE.Sphere(new THREE.Vector3(...worldPosition(entry)),Math.max(24,Number(entry.approxRadius)||(entry.type==='mesh'?1536:128))*Math.max(1,...scale.map(Math.abs)));}

  function addElement(element) {
    const children=VMAP.getWorldChildren?.(S.doc);if(!Array.isArray(children)||!element)return;
    const id=element.fields?.find(x=>x.key==='id')?.value;if(id&&VMAP.findElementByDmxId?.(S.doc,id))return;children.push(element);
  }
  function parseBlock(text, entry) {
    const fragment=VMAP.parse(String(text||''));
    const element=fragment.elements?.find(x=>x?.className===(entry.type==='mesh'?'CMapMesh':'CMapEntity'));
    if(!element)throw Error(`Could not parse ${entry.type} block`);
    const doc=VMAP.createEmptyDocument();VMAP.getWorldChildren(doc).push(element);
    return { element, objects:VMAP.extractObjects(doc).filter(x=>x?.dmxId).map(ensureObject) };
  }
  function cacheBounds(object,root){requestAnimationFrame(()=>{if(!root.parent)return;const box=new THREE.Box3().setFromObject(root);if(box.isEmpty())return;const c=box.getCenter(new THREE.Vector3()),s=box.getSize(new THREE.Vector3());st.bounds.set(object.id,{c:c.toArray(),r:Math.max(8,s.length()/2)});});}
  function showRoot(object) {
    const v=S.viewport;if(!v||!object||object.visible===false||v.objectRoots.has(object.id))return;
    if(st.active&&object.type==='entity')return;
    const root=v.createObjectRoot(object);if(!root)return;v.objectGroup.add(root);v.objectRoots.set(object.id,root);cacheBounds(object,root);if(S.selectedId===object.id)v.select(object.id,false);
  }
  function hideRoot(id) {
    const v=S.viewport,root=v?.objectRoots?.get(id);if(!root||id===S.selectedId)return;
    const object=S.objects.find(x=>x.id===id);if(object)cacheBounds(object,root);
    v.objectGroup.remove(root);v.disposeObject(root);v.objectRoots.delete(id);
  }
  function evict(entry){const id=st.loaded.get(entry.entryId),object=S.objects.find(x=>x.id===id);if(!id||id===S.selectedId||object?.ephLargeDirty)return;hideRoot(id);try{VMAP.removeObject(S.doc,object);}catch{}S.objects=S.objects.filter(x=>x.id!==id);S.viewport.objects=S.objects;st.loaded.delete(entry.entryId);}

  function bind(entry, objects) {
    for(const object of objects){const own=st.byDmx.get(String(object.dmxId))||entry;object.ephLargeEntryId=own.entryId;object.ephLargeStreamed=true;st.loaded.set(own.entryId,object.id);}
    if(entry.type==='entity'){const proxyId=`entity:${entry.dmxId||entry.entryId}`;S.objects=S.objects.filter(x=>x.id!==proxyId);}
    for(const object of objects){const i=S.objects.findIndex(x=>x.id===object.id);if(i>=0)S.objects[i]=object;else S.objects.push(object);showRoot(object);}
    S.viewport.objects=S.objects;
  }
  function scheduleTree(){if(st.tree)return;st.tree=setTimeout(()=>{st.tree=null;if(!st.active)return;renderTree?.();if(S.selectedId)renderProperties?.();},600);}

  async function loadEntries(entries) {
    if(!st.active||st.pumping)return;
    const containers=[],seen=new Set();
    for(const entry of entries){const c=containerEntry(entry);if(!c||seen.has(c.entryId)||st.pending.has(c.entryId)||st.loaded.has(c.entryId))continue;seen.add(c.entryId);containers.push(c);if(containers.length>=BATCH)break;}
    if(!containers.length)return;st.pumping=true;containers.forEach(x=>st.pending.add(x.entryId));
    try{
      const result=await api.largeMapGetBlocks?.(st.token,containers.map(x=>x.entryId));if(!st.active||!result?.ok)return;
      for(const block of result.blocks||[]){const entry=st.byId.get(block.entryId);if(!entry)continue;try{const parsed=parseBlock(block.text,entry);addElement(parsed.element);bind(entry,parsed.objects);}catch(error){console.error('Large map block failed',block.entryId,error);}}
      scheduleTree();
    }finally{containers.forEach(x=>st.pending.delete(x.entryId));st.pumping=false;schedule();}
  }

  function occluders(){const out=[];for(const [id,root] of S.viewport?.objectRoots||[]){const o=S.viewport.getObjectById(id);if(o?.type==='part'&&o.ephLargeStreamed)out.push(root);}return out;}
  function occluded(entry, roots) {
    if(!roots.length)return false;const camera=S.viewport.camera,s=sphere(entry),c=s.center,r=s.radius,ray=S.viewport.raycaster;
    for(const point of [c.clone(),c.clone().add(new THREE.Vector3(r,0,0)),c.clone().add(new THREE.Vector3(-r,0,0)),c.clone().add(new THREE.Vector3(0,r,0)),c.clone().add(new THREE.Vector3(0,-r,0)),c.clone().add(new THREE.Vector3(0,0,r)),c.clone().add(new THREE.Vector3(0,0,-r))]){
      const dir=point.clone().sub(camera.position),len=dir.length();if(len<1)return false;dir.normalize();ray.set(camera.position,dir);ray.near=.1;ray.far=Math.max(.1,len-Math.max(4,r*.04));const hit=ray.intersectObjects(roots,true)[0];ray.far=Infinity;if(!hit)return false;
    }return true;
  }
  function frustum(){const v=S.viewport;v.camera.updateMatrixWorld();return new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(v.camera.projectionMatrix,v.camera.matrixWorldInverse));}

  function refresh() {
    if(!st.active||!S.viewport?.camera)return;const view=frustum(),now=performance.now(),meshes=[],props=[];
    for(const entry of st.entries){if(entry.visible===false)continue;const inView=view.intersectsSphere(sphere(entry)),loadedId=st.loaded.get(entry.entryId),proxyId=entry.type==='entity'?`entity:${entry.dmxId||entry.entryId}`:null,object=loadedId?S.objects.find(x=>x.id===loadedId):proxyId?S.objects.find(x=>x.id===proxyId):null,rootId=loadedId||(object?.type==='prop'?object.id:null);
      if(!inView){const key=rootId||proxyId||entry.entryId;if(!st.hidden.has(key))st.hidden.set(key,now);if(now-st.hidden.get(key)>UNLOAD_MS){if(entry.type==='mesh'&&loadedId)evict(entry);else if(rootId)hideRoot(rootId);}continue;}
      st.hidden.delete(rootId||proxyId||entry.entryId);
      if(entry.type==='entity'){if(object?.type==='prop'&&!S.viewport.objectRoots.has(object.id))props.push({entry,object});}
      else if(!loadedId&&!st.pending.has(containerEntry(entry)?.entryId||entry.entryId))meshes.push(entry);
    }
    const selected=S.objects.find(x=>x.id===S.selectedId);if(selected?.ephLargeProxy){const e=st.byId.get(selected.ephLargeEntryId);if(e)loadEntries([e]);}
    const roots=occluders(), candidates=[...meshes.map(entry=>({kind:'mesh',entry,d:distance(entry)})),...props.map(x=>({kind:'prop',...x,d:distance(x.entry)}))].sort((a,b)=>a.d-b.d),toMesh=[];
    let checks=0,count=0;
    for(let i=0;i<candidates.length&&count<BATCH;i++){const c=candidates[i];if(i>=OCCLUSION_NEAR&&roots.length>=24&&checks++<10&&occluded(c.entry,roots))continue;if(c.kind==='prop')showRoot(c.object);else toMesh.push(c.entry);count++;}
    if(toMesh.length)loadEntries(toMesh);
    const resident=[...st.loaded.keys()].map(id=>st.byId.get(id)).filter(x=>x?.type==='mesh');if(resident.length>MAX_RESIDENT){resident.sort((a,b)=>distance(b)-distance(a));resident.slice(MAX_RESIDENT).forEach(evict);}
  }
  function schedule(){clearTimeout(st.refresh);st.refresh=setTimeout(()=>{st.refresh=null;refresh();},REFRESH_MS);}

  function installViewport(){const v=S.viewport||window.EPH3D;if(!v)return;v.scene.background=new THREE.Color(0);try{v.renderer.setClearColor(0,1);}catch{}
    if(!v.__ephLargeSetObjectsV16){v.__ephLargeSetObjectsV16=true;const raw=v.setObjects.bind(v);st.rawSet=raw;v.setObjects=function(objects,selectedId=null){if(!st.active)return raw(objects,selectedId);this.objects=objects||[];this.selectedId=selectedId||null;schedule();if(selectedId&&this.objectRoots.has(selectedId))this.select(selectedId,false);};const select=v.select.bind(v);v.select=function(id,notify=true){const r=select(id,notify);if(st.active)schedule();return r;};v.orbit.addEventListener('change',schedule);}
  }
  function initialCamera(){if(S.camera)return;const entry=st.entries.find(x=>/info_player_(counterterrorist|terrorist)/i.test(x.className||''))||st.entries.find(x=>x.type==='mesh')||st.entries[0];if(!entry||!S.viewport)return;const p=new THREE.Vector3(...worldPosition(entry));S.viewport.orbit.target.copy(p.clone().add(new THREE.Vector3(0,0,48)));S.viewport.camera.position.copy(p.clone().add(new THREE.Vector3(240,-360,180)));S.viewport.camera.lookAt(S.viewport.orbit.target);S.viewport.orbit.update();}

  function markDirty(){if(VMAP.applyObjectToDocument.__ephLargeDirtyV16)return;const raw=VMAP.applyObjectToDocument.bind(VMAP);VMAP.applyObjectToDocument=function(doc,object){const r=raw(doc,object);if(st.active&&object?.ephLargeEntryId&&!object.ephLargeProxy)object.ephLargeDirty=true;return r;};VMAP.applyObjectToDocument.__ephLargeDirtyV16=true;}
  function elementText(element){return VMAP.stringify({header:VMAP.DEFAULT_HEADER,elements:[element]}).replace(/^<!--\s*dmx[^\n]*-->\s*/i,'');}
  function replacementEntry(object){let e=st.byId.get(object?.ephLargeEntryId),guard=0;while(e?.parentEntryId&&guard++<12){const p=st.byId.get(e.parentEntryId);if(!p)break;if(p.type==='entity')return p;e=p;}return e;}
  function replacementElement(entry,object){if(entry?.type==='entity'&&entry.dmxId){const e=VMAP.findElementByDmxId?.(S.doc,entry.dmxId);if(e)return e;}return object?.dmxId?VMAP.findElementByDmxId?.(S.doc,object.dmxId)||null:null;}

  async function saveLarge(show=true){if(!st.active)return st.rawSave?.(show);const patches=new Map(),newBlocks=[];
    for(const object of S.objects){if(object?.dmxId&&!object.ephLargeEntryId&&!object.ephLargeProxy&&object.type!=='world'){const e=VMAP.findElementByDmxId?.(S.doc,object.dmxId);if(e)newBlocks.push(elementText(e));continue;}if(!object?.ephLargeDirty||!object.ephLargeEntryId||object.ephLargeProxy)continue;const entry=replacementEntry(object),element=replacementElement(entry,object);if(entry&&element)patches.set(entry.entryId,{entryId:entry.entryId,text:elementText(element)});}
    if(!patches.size&&!newBlocks.length){S.dirty=false;updateTitle?.();if(show)toast?.('Map already saved');return true;}
    const status=document.getElementById('autosaveStatus');if(status)status.textContent='Saving VMAP...';const result=await api.largeMapSave?.(st.token,S.project.vmapPath,[...patches.values()],newBlocks);if(!result?.ok){log?.(`Save failed: ${result?.error||'unknown error'}`,'error');toast?.('Save failed');return false;}
    if(result.largeMapToken)st.token=result.largeMapToken;if(Array.isArray(result.entries)){st.entries=result.entries;st.byId=new Map(st.entries.map(x=>[x.entryId,x]));st.byDmx=new Map(st.entries.filter(x=>x.dmxId).map(x=>[String(x.dmxId),x]));for(const object of S.objects){if(!object?.dmxId||object.ephLargeEntryId)continue;const e=st.byDmx.get(String(object.dmxId));if(e){object.ephLargeEntryId=e.entryId;object.ephLargeStreamed=true;}}}
    S.objects.forEach(x=>delete x.ephLargeDirty);S.project.ephLargeMapToken=st.token;S.dirty=false;updateTitle?.();if(status)status.textContent=`Saved ${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`;log?.(`Saved ${S.project.vmapPath}`,'success');if(show)toast?.('VMAP saved');return true;}

  function installSave(){if(!st.rawSave)st.rawSave=typeof window.save==='function'?window.save:null;const wrapped=async(show=true)=>st.active?saveLarge(show):st.rawSave?.(show);window.save=wrapped;try{save=wrapped;}catch{}for(const id of ['toolbarSave','toolbarSaveAll','exportButton']){const b=document.getElementById(id);if(b){b.disabled=false;b.onclick=()=>wrapped(true);}}
    window.addEventListener('keydown',e=>{if(!st.active||!(e.ctrlKey||e.metaKey)||e.key.toLowerCase()!=='s')return;e.preventDefault();e.stopImmediatePropagation();saveLarge(true);},true);
    if(!st.rawUi&&typeof window.uiSnapshot==='function')st.rawUi=window.uiSnapshot;if(st.rawUi&&!st.rawUi.__ephLargeUiV16){const raw=st.rawUi;const ui=function(...a){const value=raw(...a);if(st.active&&value){delete value.vmapText;value.ephLargeMap=true;value.camera=S.camera||value.camera;}return value;};ui.__ephLargeUiV16=true;window.uiSnapshot=ui;try{uiSnapshot=ui;}catch{}}}

  async function open(rawLoad,project,decoded,ui){st.active=false;const tiny=VMAP.createEmptyDocument();const ok=await rawLoad({...project,ephSkipModelWarmup:true},{...(ui||{}),vmapText:VMAP.stringify(tiny)});if(!ok)return false;st.active=true;st.token=decoded.largeMapToken;st.entries=Array.isArray(decoded.largeMapEntries)?decoded.largeMapEntries:[];st.byId=new Map(st.entries.map(x=>[x.entryId,x]));st.byDmx=new Map(st.entries.filter(x=>x.dmxId).map(x=>[String(x.dmxId),x]));st.loaded.clear();st.pending.clear();st.bounds.clear();st.hidden.clear();S.project={...project,ephLargeMap:true,ephLargeMapToken:st.token,ephLargeMapStats:{meshCount:decoded.meshCount,entityCount:decoded.entityCount,decodedBytes:decoded.decodedBytes}};S.doc=tiny;S.objects=VMAP.extractObjects(tiny).map(ensureObject);for(const entry of st.entries)if(entry.type==='entity')S.objects.push(proxy(entry));S.selectedId='world';S.dirty=false;installViewport();markDirty();installSave();if(S.viewport){S.viewport.objects=S.objects;S.viewport.clearObjects();initialCamera();}renderAll?.();updateTitle?.();schedule();await api.autosave?.({project:S.project,uiState:window.uiSnapshot?.()||null});return true;}
  async function close(){if(!st.active)return;st.active=false;clearTimeout(st.refresh);clearTimeout(st.tree);try{await api.largeMapRelease?.(st.token);}catch{}st.token=null;st.entries=[];st.byId.clear();st.byDmx.clear();st.loaded.clear();st.pending.clear();st.bounds.clear();st.hidden.clear();}

  window.EPH_LARGE_STREAM={open,close,refresh,save:saveLarge,active:()=>st.active,state:()=>({active:st.active,token:st.token,entries:st.entries.length,loaded:st.loaded.size,pending:st.pending.size})};
})();
