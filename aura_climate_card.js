/**
 * Aura Climate Card
 * ------------------
 * Home Assistant custom Lovelace kartı: dairesel (arc) sıcaklık göstergesi,
 * dokunulunca açılan mod seçim overlay'i ve ısıtma/soğutma parçacık
 * efektleri (kor/kar) ile.
 *
 * Kurulum:
 *  1) Bu dosyayı /config/www/aura_climate_card.js olarak kopyalayın.
 *  2) Ayarlar > Panolar > Kaynaklar (Resources) altına ekleyin:
 *       URL: /local/aura_climate_card.js
 *       Tür: JavaScript Modülü
 *  3) Karta "Aura Climate Card" adıyla UI editöründen ekleyin, entity
 *     seçimini açılan yapılandırma ekranından yapın (kod yazmaya gerek yok).
 *
 * YAML örneği:
 *   type: custom:aura-climate-card
 *   entity: climate.oturma_odasi
 *   name: Oturma Odası        # opsiyonel
 *   show_particles: true      # opsiyonel, varsayılan true
 */

const MODE_META = {
  off: { icon: "mdi:power", label: "Kapalı", color: "#8a8a8a" },
  heat: { icon: "mdi:fire", label: "Isıtma", color: "#ff8100" },
  cool: { icon: "mdi:snowflake", label: "Soğutma", color: "#2b9af9" },
  auto: { icon: "mdi:autorenew", label: "Otomatik", color: "#44739e" },
  heat_cool: { icon: "mdi:autorenew", label: "Oto Isı/Soğuk", color: "#44739e" },
  dry: { icon: "mdi:water-percent", label: "Kurutma", color: "#f2c94c" },
  fan_only: { icon: "mdi:fan", label: "Fan", color: "#7ed6df" },
};
const DEFAULT_MODE_META = { icon: "mdi:help-circle", label: "Bilinmiyor", color: "#8a8a8a" };

const R = 54, CX = 40, CY = 70;
const SWEEP = (4 * Math.PI) / 3; // 240 derece

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function pointFor(fraction) {
  const f = clamp(fraction, 0, 1);
  const phi = (2 * Math.PI) / 3 - f * SWEEP;
  return { x: CX + R * Math.cos(phi), y: CY + R * Math.sin(phi) };
}

function arcSegment(f0, f1) {
  const lo = Math.min(f0, f1), hi = Math.max(f0, f1);
  if (hi - lo < 0.001) return "";
  const p0 = pointFor(lo), p1 = pointFor(hi);
  const largeArc = hi - lo > 0.75 ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${R} ${R} 0 ${largeArc} 0 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

function fireEvent(node, type, detail, options) {
  options = options || {};
  detail = detail === null || detail === undefined ? {} : detail;
  const event = new Event(type, {
    bubbles: options.bubbles === undefined ? true : options.bubbles,
    cancelable: Boolean(options.cancelable),
    composed: options.composed === undefined ? true : options.composed,
  });
  event.detail = detail;
  node.dispatchEvent(event);
  return event;
}

class AuraClimateCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("aura-climate-card-editor");
  }

  static getStubConfig(hass) {
    const climates = hass ? Object.keys(hass.states).filter((e) => e.startsWith("climate.")) : [];
    return { entity: climates[0] || "", show_particles: true };
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("Lütfen bir climate entity seçin (entity alanı zorunludur)");
    }
    this._config = Object.assign({ show_particles: true }, config);
    this._popupOpen = false;
    this._optimisticTarget = null;
    this._optimisticMode = null;
    if (!this._built) this._buildDom();
    else this._updateCard();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) return;
    const stateObj = hass.states[this._config.entity];
    if (!stateObj) {
      this._showError(`Entity bulunamadı: ${this._config.entity}`);
      return;
    }
    this._stateObj = stateObj;
    if (this._optimisticMode !== null && stateObj.state === this._optimisticMode) this._optimisticMode = null;
    const curTarget = stateObj.attributes.temperature !== undefined ? stateObj.attributes.temperature : stateObj.attributes.target_temp_high;
    if (this._optimisticTarget !== null && curTarget === this._optimisticTarget) this._optimisticTarget = null;
    this._updateCard();
  }

  get hass() {
    return this._hass;
  }

  getCardSize() {
    return 3;
  }

  connectedCallback() {
    if (this._config && !this._built) this._buildDom();
  }

  _buildDom() {
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>${this._css()}</style>
      <ha-card>
        <div id="errorbox" style="display:none;padding:16px;color:#ff6961;font-size:13px;"></div>
        <div id="root">
          <div id="cardbg">
            <div id="particles"></div>
            <div id="tint"></div>
            <div id="wrap">
              <div class="arc-col">
                <div class="arc-inner">
                  <svg id="arcsvg" viewBox="0 0 108 140">
                    <path id="track" class="track"/>
                    <path id="lightfill"/>
                    <path id="darkfill"/>
                  </svg>
                  <div id="curtemp"></div>
                </div>
              </div>
              <div class="mode-col">
                <div id="thname"></div>
                <button id="modebtn" aria-label="Mod seç">
                  <ha-icon id="modeicon"></ha-icon>
                </button>
              </div>
              <div class="temp-col">
                <div class="steppers">
                  <button id="plus"><ha-icon icon="mdi:plus"></ha-icon></button>
                  <div id="targettemp"></div>
                  <button id="minus"><ha-icon icon="mdi:minus"></ha-icon></button>
                </div>
              </div>
            </div>
          </div>
          <div id="popup"></div>
        </div>
      </ha-card>
    `;
    this._els = {
      errorbox: this.shadowRoot.getElementById("errorbox"),
      root: this.shadowRoot.getElementById("root"),
      particles: this.shadowRoot.getElementById("particles"),
      tint: this.shadowRoot.getElementById("tint"),
      track: this.shadowRoot.getElementById("track"),
      lightfill: this.shadowRoot.getElementById("lightfill"),
      darkfill: this.shadowRoot.getElementById("darkfill"),
      curtemp: this.shadowRoot.getElementById("curtemp"),
      thname: this.shadowRoot.getElementById("thname"),
      modebtn: this.shadowRoot.getElementById("modebtn"),
      modeicon: this.shadowRoot.getElementById("modeicon"),
      targettemp: this.shadowRoot.getElementById("targettemp"),
      plus: this.shadowRoot.getElementById("plus"),
      minus: this.shadowRoot.getElementById("minus"),
      popup: this.shadowRoot.getElementById("popup"),
    };
    this._els.modebtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this._popupOpen = !this._popupOpen;
      this._updateCard();
    });
    this._els.popup.addEventListener("click", (e) => {
      if (e.target === this._els.popup) {
        this._popupOpen = false;
        this._updateCard();
      }
    });
    this._els.plus.addEventListener("click", () => this._adjustTarget(this._step()));
    this._els.minus.addEventListener("click", () => this._adjustTarget(-this._step()));
    this._particlesBuilt = false;
    this._built = true;
    if (this._hass && this._config) {
      const stateObj = this._hass.states[this._config.entity];
      if (stateObj) {
        this._stateObj = stateObj;
        this._updateCard();
      } else {
        this._showError(`Entity bulunamadı: ${this._config.entity}`);
      }
    }
  }

  _showError(msg) {
    if (!this._built) return;
    this._els.errorbox.textContent = msg;
    this._els.errorbox.style.display = "block";
    this._els.root.style.display = "none";
  }

  _clearError() {
    this._els.errorbox.style.display = "none";
    this._els.root.style.display = "block";
  }

  _minMax() {
    const attrs = this._stateObj.attributes;
    return {
      min: attrs.min_temp !== undefined ? attrs.min_temp : 7,
      max: attrs.max_temp !== undefined ? attrs.max_temp : 35,
    };
  }

  _step() {
    return this._stateObj.attributes.target_temp_step || 0.5;
  }

  _targetTemp() {
    if (this._optimisticTarget !== null) return this._optimisticTarget;
    const attrs = this._stateObj.attributes;
    if (attrs.temperature !== undefined && attrs.temperature !== null) return attrs.temperature;
    if (attrs.target_temp_high !== undefined && attrs.target_temp_high !== null) return attrs.target_temp_high;
    return attrs.current_temperature != null ? attrs.current_temperature : this._minMax().min;
  }

  _currentTemp() {
    const attrs = this._stateObj.attributes;
    return attrs.current_temperature != null ? attrs.current_temperature : this._targetTemp();
  }

  _mode() {
    return this._optimisticMode !== null ? this._optimisticMode : this._stateObj.state;
  }

  _adjustTarget(delta) {
    const { min, max } = this._minMax();
    const attrs = this._stateObj.attributes;
    if (attrs.temperature !== undefined && attrs.temperature !== null) {
      const newTemp = clamp(Math.round((this._targetTemp() + delta) * 10) / 10, min, max);
      this._optimisticTarget = newTemp;
      this._updateCard();
      this._hass.callService("climate", "set_temperature", {
        entity_id: this._config.entity,
        temperature: newTemp,
      });
    } else if (attrs.target_temp_high !== undefined && attrs.target_temp_high !== null) {
      const newHigh = clamp(Math.round((this._targetTemp() + delta) * 10) / 10, min, max);
      this._optimisticTarget = newHigh;
      this._updateCard();
      this._hass.callService("climate", "set_temperature", {
        entity_id: this._config.entity,
        target_temp_low: attrs.target_temp_low,
        target_temp_high: newHigh,
      });
    }
  }

  _setMode(mode) {
    this._optimisticMode = mode;
    this._popupOpen = false;
    this._updateCard();
    this._hass.callService("climate", "set_hvac_mode", {
      entity_id: this._config.entity,
      hvac_mode: mode,
    });
  }

  _setupParticles() {
    if (this._particlesBuilt) return;
    let html = "";
    for (let i = 0; i < 7; i++) {
      const left = 5 + Math.random() * 90;
      const dur = (3.5 + Math.random() * 2.5).toFixed(2);
      const delay = (Math.random() * 3.5).toFixed(2);
      const size = (8 + Math.random() * 4).toFixed(1);
      html += `<ha-icon class="snowp" icon="mdi:snowflake" style="left:${left}%;font-size:${size}px;animation-duration:${dur}s;animation-delay:${delay}s;"></ha-icon>`;
    }
    for (let i = 0; i < 8; i++) {
      const left = 8 + Math.random() * 84;
      const dur = (2 + Math.random() * 1.8).toFixed(2);
      const delay = (Math.random() * 3).toFixed(2);
      html += `<span class="emberp" style="left:${left}%;animation-duration:${dur}s;animation-delay:${delay}s;"></span>`;
    }
    this._els.particles.innerHTML = html;
    this._particlesBuilt = true;
  }

  _updateCard() {
    if (!this._built || !this._stateObj) return;
    this._clearError();
    const attrs = this._stateObj.attributes;
    const mode = this._mode();
    const meta = MODE_META[mode] || DEFAULT_MODE_META;
    const { min, max } = this._minMax();
    const cur = clamp(this._currentTemp(), min, max);
    const tgt = clamp(this._targetTemp(), min, max);
    const unit = (this._hass.config && this._hass.config.unit_system && this._hass.config.unit_system.temperature) || "°C";
    const isCooling = mode === "cool";

    const fCurrent = (cur - min) / (max - min);
    const fTarget = (tgt - min) / (max - min);

    this._els.track.setAttribute("d", arcSegment(0, 1));
    if (isCooling) {
      this._els.darkfill.setAttribute("d", arcSegment(fCurrent, 1));
      this._els.lightfill.setAttribute("d", arcSegment(fTarget, fCurrent));
    } else {
      this._els.darkfill.setAttribute("d", arcSegment(0, fCurrent));
      this._els.lightfill.setAttribute("d", arcSegment(fCurrent, fTarget));
    }
    this._els.lightfill.style.stroke = meta.color;
    this._els.lightfill.style.strokeOpacity = "0.28";
    this._els.darkfill.style.stroke = meta.color;
    this._els.darkfill.style.strokeOpacity = "1";

    this._els.curtemp.innerHTML = `${cur.toFixed(1)}<span class="deg">${unit}</span>`;
    this._els.targettemp.innerHTML = `${tgt.toFixed(1)}<span class="deg">${unit}</span>`;
    this._els.modebtn.style.color = meta.color;
    this._els.modebtn.style.background = meta.color + "26";
    this._els.modeicon.setAttribute("icon", meta.icon);
    this._els.thname.textContent = this._config.name || attrs.friendly_name || this._config.entity;
    this._els.tint.style.background = `radial-gradient(circle at 30% 40%, ${meta.color}22, transparent 70%)`;

    const action = attrs.hvac_action;
    const showParticles = this._config.show_particles !== false;
    if (showParticles) this._setupParticles();
    const snowOn = showParticles && (action ? action === "cooling" : mode === "cool");
    const emberOn = showParticles && (action ? action === "heating" : mode === "heat");
    this.shadowRoot.querySelectorAll(".snowp").forEach((el) => {
      el.style.display = snowOn ? "block" : "none";
    });
    this.shadowRoot.querySelectorAll(".emberp").forEach((el) => {
      el.style.display = emberOn ? "block" : "none";
    });

    const supported = (attrs.hvac_modes && attrs.hvac_modes.length ? attrs.hvac_modes : [mode]);
    if (!supported.includes(mode)) supported.push(mode);
    this._els.popup.innerHTML = supported
      .map((m) => {
        const mm = MODE_META[m] || DEFAULT_MODE_META;
        const active = m === mode;
        const st = active ? `color:${mm.color};border-color:${mm.color};background:${mm.color}26;` : "";
        return `<button data-mode="${m}" style="${st}"><ha-icon icon="${mm.icon}"></ha-icon><span>${mm.label}</span></button>`;
      })
      .join("");
    this._els.popup.style.opacity = this._popupOpen ? "1" : "0";
    this._els.popup.style.pointerEvents = this._popupOpen ? "auto" : "none";
    this._els.popup.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._setMode(btn.getAttribute("data-mode"));
      });
    });
  }

  _css() {
    return `
      ha-card { background: transparent; box-shadow: none; border: none; padding: 0; }
      #root { background: var(--ha-card-background, var(--card-background-color, #fff)); border-radius: var(--ha-card-border-radius, 12px); padding: 1.1rem; }
      #cardbg { position: relative; background: #1c1c1e; border-radius: 12px; padding: 8px 10px; box-sizing: border-box; overflow: hidden; }
      #particles { position: absolute; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
      #tint { position: absolute; inset: 0; pointer-events: none; z-index: 0; transition: background .3s ease; }
      #wrap { position: relative; z-index: 1; display: grid; grid-template-columns: 1fr 0.9fr 0.75fr; align-items: center; gap: 2px; height: 110px; }
      .arc-col { position: relative; display: flex; align-items: center; justify-content: center; height: 100%; }
      .arc-inner { position: relative; height: 100%; display: inline-block; }
      #arcsvg { height: 100%; width: auto; display: block; }
      .track { fill: none; stroke: #555; opacity: .35; stroke-width: 13; stroke-linecap: round; }
      #lightfill, #darkfill { fill: none; stroke-width: 13; stroke-linecap: round; transition: d .15s ease, stroke .15s ease; }
      #curtemp { position: absolute; top: 50%; left: 37.03%; transform: translate(-50%,-50%); font-size: 17px; font-weight: 600; color: #fff; line-height: 1; text-align: center; white-space: nowrap; }
      #curtemp .deg, #targettemp .deg { font-size: 11px; font-weight: 400; opacity: .7; }
      .mode-col { position: relative; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; }
      #thname { font-size: 12px; font-weight: 600; color: #fff; line-height: 1.15; text-align: center; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #modebtn { background: rgba(255,255,255,.08); border: none; cursor: pointer; width: 44px; height: 44px; min-width: 44px; min-height: 44px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
      #modeicon { --mdc-icon-size: 22px; }
      .temp-col { display: flex; flex-direction: column; align-items: center; justify-content: center; }
      .steppers { display: flex; flex-direction: column; align-items: center; background: rgba(255,255,255,.06); border-radius: 22px; padding: 4px; gap: 7px; }
      .steppers button { background: none; border: none; cursor: pointer; width: 32px; height: 26px; display: flex; align-items: center; justify-content: center; color: #fff; border-radius: 16px; }
      .steppers button ha-icon { --mdc-icon-size: 16px; }
      #targettemp { font-size: 15px; font-weight: 700; color: #fff; }
      #popup { position: absolute; inset: 0; background: rgba(28,28,30,.94); display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; opacity: 0; pointer-events: none; transition: opacity .15s ease; z-index: 5; border-radius: inherit; }
      #popup button { display: flex; flex-direction: column; align-items: center; gap: 3px; background: rgba(255,255,255,.06); border: 2px solid transparent; cursor: pointer; width: 52px; padding: 7px 0 5px; border-radius: 12px; font-size: 10px; color: #fff; }
      #popup button ha-icon { --mdc-icon-size: 20px; }
      @keyframes snowfall { 0%{transform:translate(0,-8px) rotate(0deg);opacity:0;} 12%{opacity:.6;} 30%{transform:translate(16px,25px) rotate(90deg);} 50%{transform:translate(-14px,55px) rotate(180deg);} 70%{transform:translate(12px,80px) rotate(270deg);} 100%{transform:translate(-6px,116px) rotate(360deg);opacity:0;} }
      @keyframes emberflicker { 0%{transform:translate(0,6px) scale(.5);opacity:0;box-shadow:0 0 2px #ffa94d;} 20%{opacity:.75;transform:translate(3px,-14px) scale(1.1);box-shadow:0 0 5px #ffb066;} 50%{transform:translate(-3px,-45px) scale(.8);opacity:.55;} 75%{transform:translate(4px,-75px) scale(1);opacity:.4;} 100%{transform:translate(-2px,-112px) scale(.3);opacity:0;box-shadow:0 0 1px transparent;} }
      .snowp { position: absolute; bottom: 0; color: #cfe8ff; animation: snowfall linear infinite; --mdc-icon-size: 1em; }
      .emberp { position: absolute; bottom: 0; width: 3px; height: 3px; border-radius: 50%; background: #ffa94d; animation: emberflicker ease-in infinite; }
    `;
  }
}

customElements.define("aura-climate-card", AuraClimateCard);

class AuraClimateCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = Object.assign({}, config);
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _configChanged(newConfig) {
    this._config = newConfig;
    fireEvent(this, "config-changed", { config: this._config });
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (this._rendered) {
      if (this._entityPicker) {
        this._entityPicker.hass = this._hass;
        this._entityPicker.value = this._config.entity || "";
      }
      if (this._nameField) this._nameField.value = this._config.name || "";
      if (this._particlesSwitch) this._particlesSwitch.checked = this._config.show_particles !== false;
      return;
    }
    this.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;flex-direction:column;gap:16px;padding:8px 2px;";

    const entityPicker = document.createElement("ha-entity-picker");
    entityPicker.hass = this._hass;
    entityPicker.label = "Klima Entity (zorunlu)";
    entityPicker.value = this._config.entity || "";
    entityPicker.includeDomains = ["climate"];
    entityPicker.required = true;
    entityPicker.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      this._configChanged(Object.assign({}, this._config, { entity: ev.detail.value }));
    });
    this._entityPicker = entityPicker;

    const nameField = document.createElement("ha-textfield");
    nameField.label = "Görünen isim (opsiyonel)";
    nameField.value = this._config.name || "";
    nameField.addEventListener("change", (ev) => {
      this._configChanged(Object.assign({}, this._config, { name: ev.target.value }));
    });
    this._nameField = nameField;

    const switchRow = document.createElement("div");
    switchRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;";
    const switchLabel = document.createElement("span");
    switchLabel.textContent = "Kar / ateş parçacık efektleri";
    switchLabel.style.cssText = "font-size:14px;color:var(--primary-text-color);";
    const particlesSwitch = document.createElement("ha-switch");
    particlesSwitch.checked = this._config.show_particles !== false;
    particlesSwitch.addEventListener("change", (ev) => {
      this._configChanged(Object.assign({}, this._config, { show_particles: ev.target.checked }));
    });
    this._particlesSwitch = particlesSwitch;
    switchRow.appendChild(switchLabel);
    switchRow.appendChild(particlesSwitch);

    wrap.appendChild(entityPicker);
    wrap.appendChild(nameField);
    wrap.appendChild(switchRow);
    this.appendChild(wrap);
    this._rendered = true;
  }
}

customElements.define("aura-climate-card-editor", AuraClimateCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "aura-climate-card",
  name: "Aura Climate Card",
  description: "Dairesel gösterge, mod popup'ı ve kar/ateş parçacık efektli klima kartı",
  preview: false,
});
