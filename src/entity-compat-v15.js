// byanca
(() => {
  'use strict';

  if (window.__ephEntityCompatV15) return;
  window.__ephEntityCompatV15 = true;

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = 'entity-compat-v15.css';
  document.head.appendChild(style);

  const PRESETS = [
    ['CT Spawn', 'info_player_counterterrorist'],
    ['T Spawn', 'info_player_terrorist'],
    ['Map Parameters', 'info_map_parameters'],
    ['Target', 'info_target'],
    ['Particle System', 'info_particle_system'],
    ['Projected Decal', 'info_projecteddecal'],
    ['Sound Event', 'point_soundevent'],
    ['Camera', 'point_camera'],
    ['Template', 'point_template'],
    ['Sky', 'env_sky'],
    ['Gradient Fog', 'env_gradient_fog'],
    ['Cubemap Fog', 'env_cubemap_fog'],
    ['Soundscape', 'env_soundscape'],
    ['Wind', 'env_wind'],
    ['CS Place', 'env_cs_place'],
    ['Player Visibility', 'env_player_visibility'],
    ['Combined Light Probe Volume', 'env_combined_light_probe_volume'],
    ['Omni Light', 'light_omni2'],
    ['Barn Light', 'light_barn'],
    ['Rect Light', 'light_rect'],
    ['Environment Light', 'light_environment'],
    ['Static Prop', 'prop_static'],
    ['Dynamic Prop', 'prop_dynamic'],
    ['Physics Prop', 'prop_physics'],
    ['Ragdoll Prop', 'prop_ragdoll'],
    ['Door', 'func_door'],
    ['Rotating Door', 'func_door_rotating'],
    ['Moving Brush', 'func_movelinear'],
    ['Rotating Brush', 'func_rotating'],
    ['Button', 'func_button'],
    ['Breakable / Vent', 'func_breakable'],
    ['Brush Entity', 'func_brush'],
    ['Water', 'func_water'],
    ['Ladder', 'func_ladder'],
    ['Bomb Target', 'func_bomb_target'],
    ['Buy Zone', 'func_buyzone'],
    ['Hostage Rescue Zone', 'func_hostage_rescue'],
    ['Nav Markup', 'func_nav_markup'],
    ['Nav Blocker', 'func_nav_blocker'],
    ['Nav Avoid', 'func_nav_avoid'],
    ['Nav Prefer', 'func_nav_prefer'],
    ['Trigger Multiple', 'trigger_multiple'],
    ['Trigger Once', 'trigger_once'],
    ['Trigger Hurt', 'trigger_hurt'],
    ['Trigger Push', 'trigger_push'],
    ['Trigger Teleport', 'trigger_teleport'],
    ['Trigger Gravity', 'trigger_gravity'],
    ['Trigger Look', 'trigger_look'],
    ['Logic Relay', 'logic_relay'],
    ['Logic Auto', 'logic_auto'],
    ['Logic Timer', 'logic_timer'],
    ['Logic Compare', 'logic_compare'],
    ['Logic Case', 'logic_case'],
    ['Logic Branch', 'logic_branch'],
    ['Math Counter', 'math_counter'],
    ['Filter by Name', 'filter_activator_name'],
    ['Filter by Class', 'filter_activator_class'],
    ['Filter by Team', 'filter_activator_team'],
    ['Path Corner', 'path_corner'],
    ['Path Track', 'path_track'],
    ['Particle Rope Path', 'path_particle_rope_clientside'],
    ['Mini-map Boundary', 'cs_minimap_boundary'],
    ['Game Player Equip', 'game_player_equip'],
  ];

  const COMMON_KEYS = [
    'parentname', 'parentAttachmentName', 'useLocalOffset', 'spawnflags', 'StartDisabled', 'enabled',
    'speed', 'wait', 'lip', 'distance', 'health', 'damage', 'model', 'skin', 'solid',
    'effect_name', 'start_active', 'clientSideEntity', 'soundevent', 'soundscape',
    'color', 'brightness', 'range', 'castshadows', 'filtername', 'target', 'target2',
    'message', 'value', 'CompareValue', 'RefireTime', 'LowerRandomBound', 'UpperRandomBound'
  ];

  const CLASS_KEYS = {
    func_door: ['speed', 'wait', 'lip', 'spawnflags', 'movedir', 'damage'],
    func_door_rotating: ['speed', 'wait', 'distance', 'spawnflags', 'damage'],
    func_movelinear: ['speed', 'movedir', 'startposition', 'spawnflags'],
    func_rotating: ['maxspeed', 'fanfriction', 'spawnflags'],
    func_button: ['speed', 'wait', 'spawnflags', 'movedir'],
    func_breakable: ['health', 'spawnflags', 'material'],
    info_particle_system: ['effect_name', 'start_active', 'clientSideEntity', 'parentname', 'parentAttachmentName', 'useLocalOffset'],
    point_soundevent: ['soundevent', 'start_on'],
    env_soundscape: ['soundscape', 'radius', 'StartDisabled'],
    env_gradient_fog: ['StartDisabled', 'fogstart', 'fogend', 'fogcolor'],
    env_cubemap_fog: ['StartDisabled'],
    env_wind: ['minwind', 'maxwind', 'mingust', 'maxgust'],
    light_omni2: ['color', 'brightness', 'range', 'castshadows'],
    light_barn: ['color', 'brightness', 'range', 'castshadows'],
    light_rect: ['color', 'brightness', 'range', 'castshadows'],
    light_environment: ['color', 'brightness', 'castshadows'],
    trigger_multiple: ['wait', 'StartDisabled', 'filtername', 'spawnflags'],
    trigger_once: ['StartDisabled', 'filtername', 'spawnflags'],
    trigger_hurt: ['damage', 'damagecap', 'damagetype', 'StartDisabled', 'filtername'],
    trigger_push: ['speed', 'pushdir', 'StartDisabled', 'filtername'],
    logic_timer: ['RefireTime', 'UseRandomTime', 'LowerRandomBound', 'UpperRandomBound', 'StartDisabled'],
    logic_compare: ['InitialValue', 'CompareValue'],
    math_counter: ['startvalue', 'min', 'max'],
  };

  const DESCRIPTIONS = {
    info_particle_system: 'Spawns a Source 2 particle system. Set effect_name to the particle system resource/name.',
    point_soundevent: 'Plays a Source 2 sound event at this entity.',
    func_door: 'Brush/mesh door entity. Imported door geometry is preserved; a newly created func_door still needs brush geometry.',
    func_door_rotating: 'Rotating brush/mesh door entity. Imported geometry is preserved.',
    func_breakable: 'Breakable brush/mesh entity; useful for breakable vents, panels and glass.',
    func_water: 'Brush/mesh water entity.',
    trigger_multiple: 'Volume trigger that can fire repeatedly while entities touch it.',
    func_bomb_target: 'CS2 bomb plant site volume.',
    func_buyzone: 'CS2 buy-zone volume.',
    env_gradient_fog: 'Source 2 gradient fog controller.',
    env_sky: 'Controls the Source 2 sky.',
  };

  function installCatalog() {
    if (!Array.isArray(ENTITIES)) return;
    const known = new Set(ENTITIES.map(item => String(item.className || '').toLowerCase()));
    for (const [name, className] of PRESETS) {
      if (known.has(className.toLowerCase())) continue;
      ENTITIES.push({ name, className, kind: 'entity', source: 'CS2 / Source 2' });
      known.add(className.toLowerCase());
    }
    ENTITIES.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }

  function safeKey(value) {
    return String(value || '').trim().replace(/[\x00-\x1f]/g, '').slice(0, 96);
  }

  function isReserved(key) {
    return ['id', 'classname', 'targetname', 'model'].includes(String(key || '').toLowerCase());
  }

  function applyEntity(object, message) {
    VMAP.applyObjectToDocument(S.doc, object);
    S.viewport?.updateObject?.(object);
    markDirty?.(message || `Changed ${object.name}`);
  }

  function suggestionsFor(className) {
    const keys = [...(CLASS_KEYS[className] || []), ...COMMON_KEYS];
    return [...new Set(keys)];
  }

  function editorHtml(object) {
    const props = object.entityProperties || (object.entityProperties = {});
    const entries = Object.entries(props)
      .filter(([key]) => !isReserved(key))
      .sort(([a], [b]) => a.localeCompare(b));
    const className = String(object.className || 'info_target');
    const description = DESCRIPTIONS[className]
      || (/^(func_|trigger_)/.test(className)
        ? 'Brush/volume entity. Existing Hammer geometry and unknown fields are preserved when EasyPeasyHammer edits scalar KeyValues.'
        : 'Generic Source 2 entity. Unknown scalar KeyValues are preserved and can be edited here.');
    const suggestions = suggestionsFor(className);

    return `<div class="property-section eph-entity-compat-section">
      <div class="property-section-title">Entity KeyValues</div>
      <div class="selection-info eph-entity-description">${esc(description)}</div>
      <div class="eph-entity-kv-list">
        ${entries.length ? entries.map(([key, value], index) => `<div class="eph-entity-kv-row" data-index="${index}" data-original-key="${esc(key)}">
          <input class="prop-input eph-entity-kv-key" value="${esc(key)}" title="KeyValue name">
          <input class="prop-input eph-entity-kv-value" value="${esc(value)}" title="KeyValue value">
          <button class="mini-button eph-entity-kv-remove" type="button" title="Remove KeyValue">×</button>
        </div>`).join('') : '<div class="eph-entity-kv-empty">No extra scalar KeyValues on this entity yet.</div>'}
      </div>
      <div class="eph-entity-kv-add">
        <input id="ephEntityNewKey" class="prop-input" list="ephEntityKeySuggestions" placeholder="KeyValue">
        <input id="ephEntityNewValue" class="prop-input" placeholder="Value">
        <button id="ephEntityAddKey" class="mini-button" type="button">Add</button>
      </div>
      <datalist id="ephEntityKeySuggestions">${suggestions.map(key => `<option value="${esc(key)}"></option>`).join('')}</datalist>
      <div class="selection-info">Name above maps to <code>targetname</code>; Class and Model have their own fields. Imported connections/I/O and non-scalar Hammer data are left untouched even when this editor does not expose them yet.${S.project?.ephReadOnlySource ? ' This large-map preview cannot overwrite the source VMAP.' : ''}</div>
    </div>`;
  }

  function bindEditor(object) {
    const section = document.querySelector('.eph-entity-compat-section');
    if (!section) return;
    object.entityProperties ||= {};

    section.querySelectorAll('.eph-entity-kv-row').forEach(row => {
      const keyInput = row.querySelector('.eph-entity-kv-key');
      const valueInput = row.querySelector('.eph-entity-kv-value');
      const remove = row.querySelector('.eph-entity-kv-remove');
      const originalKey = row.dataset.originalKey;

      const commit = () => {
        const nextKey = safeKey(keyInput.value);
        if (!nextKey || isReserved(nextKey)) {
          keyInput.value = originalKey;
          toast?.('Use the Name, Class or Model fields for reserved entity properties');
          return;
        }
        pushHistory?.();
        const value = String(valueInput.value ?? '');
        if (nextKey !== originalKey) delete object.entityProperties[originalKey];
        object.entityProperties[nextKey] = value;
        applyEntity(object, `Changed ${nextKey} on ${object.name}`);
        renderProperties?.();
      };

      keyInput.addEventListener('change', commit);
      valueInput.addEventListener('change', commit);
      valueInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); valueInput.blur(); }
      });
      remove.addEventListener('click', () => {
        pushHistory?.();
        delete object.entityProperties[originalKey];
        applyEntity(object, `Removed ${originalKey} from ${object.name}`);
        renderProperties?.();
      });
    });

    const add = section.querySelector('#ephEntityAddKey');
    const key = section.querySelector('#ephEntityNewKey');
    const value = section.querySelector('#ephEntityNewValue');
    const addProperty = () => {
      const nextKey = safeKey(key?.value);
      if (!nextKey) return toast?.('Enter a KeyValue name');
      if (isReserved(nextKey)) return toast?.('Use the Name, Class or Model fields for that property');
      pushHistory?.();
      object.entityProperties[nextKey] = String(value?.value ?? '');
      applyEntity(object, `Added ${nextKey} to ${object.name}`);
      renderProperties?.();
    };
    add?.addEventListener('click', addProperty);
    value?.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); addProperty(); }
    });
  }

  function installPropertyEditor() {
    if (typeof renderProperties !== 'function' || renderProperties.__ephEntityCompatV15) return;
    const rawRenderProperties = renderProperties;
    renderProperties = function(...args) {
      const result = rawRenderProperties(...args);
      const object = current?.();
      const host = document.getElementById('propertiesContent');
      if (object && host && ['entity', 'prop'].includes(object.type) && !host.querySelector('.eph-entity-compat-section')) {
        host.insertAdjacentHTML('beforeend', editorHtml(object));
        bindEditor(object);
      }
      return result;
    };
    renderProperties.__ephEntityCompatV15 = true;
    window.renderProperties = renderProperties;
  }

  function installAddEntityDefaults() {
    if (typeof addEntity !== 'function' || addEntity.__ephEntityCompatV15) return;
    const rawAddEntity = addEntity;
    addEntity = function(item = {}) {
      const result = rawAddEntity(item);
      const object = current?.();
      if (object && object.type === 'entity' && item.className && object.className === item.className) {
        object.entityProperties ||= {};
        object.ephEntityCatalogSource = item.source || 'CS2 / Source 2';
        renderProperties?.();
      }
      return result;
    };
    addEntity.__ephEntityCompatV15 = true;
    window.addEntity = addEntity;
  }

  installCatalog();
  installPropertyEditor();
  installAddEntityDefaults();
  if (S.assetTab === 'entities') queueAssetSearch?.(true);
  if (S.project) renderProperties?.();
})();
