// byanca
(() => {
  'use strict';
  if (window.__ephParticleSystemUnifiedV26) return;
  window.__ephParticleSystemUnifiedV26 = true;

  const PARTICLE_CLASS = 'info_particle_system';
  let wrappedMarker = null;
  let wrappedProperties = null;

  const isParticle = object => String(object?.className || '').trim().toLowerCase() === PARTICLE_CLASS;
  const effectPath = object => String(object?.entityProperties?.effect_name || object?.particleResource || '').trim();

  function decorate(object) {
    if (!isParticle(object)) return object;
    object.ephParticleSystem = true;
    object.entityProperties ||= {};
    object.particleResource = effectPath(object);
    object.entityProperties.start_active ??= '1';
    return object;
  }

  function decorateAll() {
    for (const object of S?.objects || []) decorate(object);
  }

  function installStyle() {
    if (document.getElementById('ephParticleSystemUnifiedV26Style')) return;
    const style = document.createElement('style');
    style.id = 'ephParticleSystemUnifiedV26Style';
    style.textContent = `
      .eph-particle-summary{margin:0 0 10px;padding:9px 10px;border:1px solid #2f3b48;border-radius:5px;background:#121821;}
      .eph-particle-summary-title{font-size:11px;font-weight:700;color:#dce8f4;margin-bottom:4px;}
      .eph-particle-summary-path{font-family:Consolas,monospace;font-size:10px;color:#8fc7ef;white-space:normal;overflow-wrap:anywhere;}
      .eph-particle-summary-note{margin-top:5px;font-size:9px;line-height:1.35;color:#7f8b99;}
    `;
    document.head.appendChild(style);
  }

  function makeParticleMarker(object) {
    const THREE = window.EPH_THREE || window.THREE;
    if (!THREE) return null;

    const group = new THREE.Group();
    group.userData.ephVisual = true;
    group.userData.ephParticleSystem = true;

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 128, 128);
      ctx.beginPath();
      ctx.arc(64, 64, 48, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(20,28,38,.88)';
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(105,190,245,.95)';
      ctx.stroke();
      ctx.font = '700 42px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#e8f6ff';
      ctx.fillText('FX', 64, 67);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(24, 24, 1);
    sprite.renderOrder = 950;
    sprite.userData.ephVisual = true;
    sprite.userData.ephParticleSystem = true;
    sprite.userData.effectName = effectPath(object);
    group.add(sprite);

    // A tiny invisible hit target keeps the unified particle object easy to
    // select without showing Hammer's large generic helper in EasyPeasyHammer.
    const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const hit = new THREE.Mesh(new THREE.SphereGeometry(9, 10, 8), hitMaterial);
    hit.userData.ephVisual = true;
    hit.userData.ephParticleSystem = true;
    group.add(hit);

    return group;
  }

  function installMarker() {
    const viewport = window.EPH3D || S?.viewport;
    if (!viewport?.createEntityMarker) return false;
    if (viewport.createEntityMarker.__ephParticleSystemUnifiedV26) return true;

    const raw = viewport.createEntityMarker.bind(viewport);
    const wrapped = function(object) {
      if (isParticle(object)) {
        decorate(object);
        return makeParticleMarker(object) || raw(object);
      }
      return raw(object);
    };
    wrapped.__ephParticleSystemUnifiedV26 = true;
    // entity-fidelity-v18 periodically restores its renderer unless this marker
    // is present. Keep that contract while specializing particle systems only.
    wrapped.__ephHammerFinalV18 = true;
    wrapped.__ephPrevious = raw;
    viewport.createEntityMarker = wrapped;
    wrappedMarker = wrapped;

    for (const object of S?.objects || []) if (isParticle(object)) viewport.updateObject?.(object);
    return true;
  }

  function enhanceProperties() {
    const object = current?.();
    if (!isParticle(object)) return;
    decorate(object);
    const host = document.getElementById('propertiesContent');
    if (!host) return;

    const badge = host.querySelector('.type-badge');
    if (badge) badge.textContent = 'particle system';

    for (const row of host.querySelectorAll('.field-row')) {
      const label = row.querySelector('label');
      if (String(label?.textContent || '').trim().toLowerCase() === 'model') row.style.display = 'none';
    }

    if (!host.querySelector('.eph-particle-summary')) {
      const summary = document.createElement('div');
      summary.className = 'eph-particle-summary';
      const path = effectPath(object) || '(no particle selected)';
      summary.innerHTML = `
        <div class="eph-particle-summary-title">Particle System</div>
        <div class="eph-particle-summary-path"></div>
        <div class="eph-particle-summary-note">This one object contains its transform and particle settings. EasyPeasyHammer does not create a separate helper object. Hammer will display its own helper for this info_particle_system when the VMAP is opened there.</div>`;
      summary.querySelector('.eph-particle-summary-path').textContent = path;
      const nameRow = host.querySelector('.property-name-row');
      if (nameRow) nameRow.insertAdjacentElement('afterend', summary);
      else host.prepend(summary);
    }
  }

  function installProperties() {
    if (typeof renderProperties !== 'function') return false;
    if (renderProperties.__ephParticleSystemUnifiedV26) return true;
    const raw = renderProperties;
    const wrapped = function(...args) {
      const result = raw(...args);
      queueMicrotask(enhanceProperties);
      return result;
    };
    for (const key of Object.keys(raw)) if (key.startsWith('__eph')) wrapped[key] = raw[key];
    wrapped.__ephParticleSystemUnifiedV26 = true;
    wrapped.__ephPrevious = raw;
    renderProperties = wrapped;
    window.renderProperties = wrapped;
    wrappedProperties = wrapped;
    queueMicrotask(enhanceProperties);
    return true;
  }

  function refreshParticleVisuals() {
    decorateAll();
    installMarker();
    installProperties();
  }

  installStyle();
  refreshParticleVisuals();
  window.addEventListener('eph3d-ready', refreshParticleVisuals);
  window.addEventListener('eph-runtime-ready', refreshParticleVisuals, { once: true });

  // Later integrity passes can replace viewport hooks. Re-claim only the
  // particle specialization for a short bounded startup window.
  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    installMarker();
    installProperties();
    if (checks >= 40) clearInterval(guard);
  }, 250);

  window.EPH_PARTICLE_SYSTEM = { isParticle, decorate, effectPath };
  console.info('[Particle System V26] Unified particle objects enabled; no separate EPH particle helpers are exported.');
})();
