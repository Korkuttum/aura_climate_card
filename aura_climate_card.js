/*
 * Aura Climate Card - Düzeltilmiş Versiyon
 */

const MODE_ICONS = {
  off: "mdi:power",
  heat: "mdi:fire",
  cool: "mdi:snowflake",
  heat_cool: "mdi:autorenew",
  auto: "mdi:autorenew",
  dry: "mdi:water-percent",
  fan_only: "mdi:fan",
};

const MODE_LABELS_TR = {
  off: "Kapali",
  heat: "Isitma",
  cool: "Sogutma",
  heat_cool: "Otomatik",
  auto: "Otomatik",
  dry: "Kurutma",
  fan_only: "Fan",
};

const ACTION_COLORS = {
  heating: "#ff8100",
  cooling: "#2b9af9",
  drying: "#efbd07",
  fan: "#44739e",
  idle: "#8a8a8a",
  off: "#8a8a8a",
};

const MODE_COLORS = {
  off: "#8a8a8a",
  heat: "#ff8100",
  cool: "#2b9af9",
  heat_cool: "#009485",
  auto: "#44739e",
  dry: "#efbd07",
  fan_only: "#44739e",
};

const FALLBACK_COLOR = "#44739e";

// ===== YENİ ÇEMBER HESAPLAMALARI =====
// 180 derecelik yay, sol üstten başlayıp sağ üste doğru
const CENTER_X = 50;
const CENTER_Y = 50;
const RADIUS = 45;
const START_ANGLE = Math.PI; // 180 derece (sol)
const END_ANGLE = 0; // 0 derece (sağ)

function getPoint(progress) {
  // progress: 0-1 arası, 0=başlangıç, 1=bitiş
  const angle = START_ANGLE - progress * Math.PI;
  return {
    x: CENTER_X + RADIUS * Math.cos(angle),
    y: CENTER_Y + RADIUS * Math.sin(angle)
  };
}

function createArc(startProgress, endProgress) {
  if (startProgress >= endProgress) return "";
  
  const start = getPoint(startProgress);
  const end = getPoint(endProgress);
  const diff = endProgress - startProgress;
  const largeArc = diff > 0.5 ? 1 : 0;
  
  return `M ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

class AuraClimateCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._popupOpen = false;
    this._optimisticUntil = 0;
    this._optimisticTemp = null;
    this._optimisticMode = null;
    this._built = false;
    this._boundOutsideClick = this._handleOutsideClick.bind(this);
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error('Lutfen bir "entity" tanimlayin');
    }
    this._config = config;
  }

  set hass(hass) {
    this._hass = hass;
    const stateObj = hass.states[this._config.entity];

    if (!stateObj) {
      this._stateObj = null;
      this._renderNotFound();
      return;
    }

    if (this._optimisticUntil && Date.now() < this._optimisticUntil) {
      const tempCaughtUp =
        this._optimisticTemp == null ||
        stateObj.attributes.temperature === this._optimisticTemp;
      const modeCaughtUp =
        this._optimisticMode == null || stateObj.state === this._optimisticMode;
      if (!(tempCaughtUp && modeCaughtUp)) {
        return;
      }
      this._optimisticUntil = 0;
      this._optimisticTemp = null;
      this._optimisticMode = null;
    }

    this._stateObj = stateObj;
    const sig = JSON.stringify(stateObj.state) + JSON.stringify(stateObj.attributes);
    if (sig !== this._lastSig) {
      this._lastSig = sig;
      if (!this._built) {
        this._buildStructure();
      }
      this._update();
    }
  }

  connectedCallback() {
    document.addEventListener("click", this._boundOutsideClick, true);
  }

  disconnectedCallback() {
    document.removeEventListener("click", this._boundOutsideClick, true);
  }

  _handleOutsideClick(e) {
    if (!this._popupOpen) return;
    const path = e.composedPath();
    if (!path.includes(this)) {
      this._popupOpen = false;
      this._renderPopup();
    }
  }

  getCardSize() { return 2; }
  getGridOptions() {
    return { columns: 6, rows: 2, min_columns: 4, max_columns: 12 };
  }
  static getStubConfig() { return { entity: "" }; }

  _callService(domain, service, data) {
    this._hass.callService(domain, service, data);
  }

  _setHvacMode(mode, e) {
    if (e) e.stopPropagation();
    this._optimisticMode = mode;
    this._optimisticUntil = Date.now() + 6000;
    this._stateObj = { ...this._stateObj, state: mode };
    this._popupOpen = false;
    this._update();
    this._callService("climate", "set_hvac_mode", {
      entity_id: this._config.entity,
      hvac_mode: mode,
    });
  }

  _changeTemp(delta, e) {
    if (e) e.stopPropagation();
    const attrs = this._stateObj.attributes;
    const step = attrs.target_temp_step || 0.5;
    let current = attrs.temperature;
    if (current == null) return;
    let next = Math.round((current + delta * step) * 10) / 10;
    const min = attrs.min_temp ?? 7;
    const max = attrs.max_temp ?? 35;
    next = Math.min(max, Math.max(min, next));

    this._optimisticTemp = next;
    this._optimisticUntil = Date.now() + 6000;
    this._stateObj = {
      ...this._stateObj,
      attributes: { ...this._stateObj.attributes, temperature: next },
    };
    this._update();
    this._callService("climate", "set_temperature", {
      entity_id: this._config.entity,
      temperature: next,
    });
  }

  _togglePopup(e) {
    e.stopPropagation();
    this._popupOpen = !this._popupOpen;
    this._renderPopup();
  }

  _renderNotFound() {
    this._built = false;
    this.shadowRoot.innerHTML = `
      <ha-card>
        <div class="not-found">Varlik bulunamadi: ${this._config.entity}</div>
      </ha-card>
      <style>
        ha-card { padding: 16px; }
        .not-found { color: var(--error-color, red); font-size: 14px; }
      </style>
    `;
  }

  _buildStructure() {
    this.shadowRoot.innerHTML = `
      <ha-card>
        <div class="cardbg">
          <div class="tint"></div>
          <div class="content">
            <div class="wrap">
              <div class="arc-col">
                <div class="arc-inner">
                  <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
                    <!-- Track (arka plan) -->
                    <path class="track" d="${createArc(0, 1)}" />
                    <!-- Dark katmanı (mevcut sıcaklık) -->
                    <path class="darkfill" d="" />
                    <!-- Light katmanı (hedef sıcaklık) -->
                    <path class="lightfill" d="" />
                    <!-- Sıcaklık değeri -->
                    <text x="50" y="52" text-anchor="middle" dominant-baseline="central" 
                          font-size="18" font-weight="700" fill="#ffffff"
                          style="pointer-events:none;">
                      <tspan class="curtemp-val">--</tspan>
                      <tspan class="curtemp-unit" dy="-5" font-size="11" opacity="0.7">°C</tspan>
                    </text>
                  </svg>
                </div>
              </div>
              <div class="mode-col">
                <div class="thname">Climate</div>
                <button class="modebtn">
                  <ha-icon class="modeicon" icon="mdi:thermostat"></ha-icon>
                </button>
              </div>
              <div class="temp-col">
                <div class="capsule">
                  <button class="btn-plus"><ha-icon icon="mdi:plus"></ha-icon></button>
                  <div class="targettemp">--<span class="deg">°C</span></div>
                  <button class="btn-minus"><ha-icon icon="mdi:minus"></ha-icon></button>
                </div>
              </div>
            </div>
            <div class="popup"></div>
          </div>
        </div>
      </ha-card>

      <style>
        :host {
          display: block;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
        }
        ha-card {
          height: 100%;
          box-sizing: border-box;
          padding: 0;
          display: flex;
          align-items: stretch;
          overflow: hidden;
          background: transparent;
          box-shadow: none;
          border-radius: var(--ha-card-border-radius, 12px);
        }
        .cardbg {
          position: relative;
          width: 100%;
          height: 100%;
          background: #1c1c1e;
          box-sizing: border-box;
          padding: 8px;
          overflow: hidden;
          border-radius: var(--ha-card-border-radius, 12px);
        }
        .tint {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 0;
          transition: background 0.3s ease;
        }
        .content {
          position: relative;
          z-index: 1;
          height: 100%;
          box-sizing: border-box;
        }
        .wrap {
          display: grid;
          grid-template-columns: 120px 1fr 1fr;
          align-items: center;
          gap: 8px;
          height: 100%;
          padding: 0 4px;
          box-sizing: border-box;
        }
        .arc-col {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
        }
        .arc-inner {
          width: 100px;
          height: 100px;
          flex-shrink: 0;
        }
        .arc-inner svg {
          width: 100px;
          height: 100px;
          display: block;
        }
        .track {
          fill: none;
          stroke: #444;
          opacity: 0.4;
          stroke-width: 8;
          stroke-linecap: round;
        }
        .darkfill {
          fill: none;
          stroke-width: 8;
          stroke-linecap: round;
          transition: d 0.2s ease;
        }
        .lightfill {
          fill: none;
          stroke-width: 8;
          stroke-linecap: round;
          transition: d 0.2s ease;
        }
        .mode-col {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
        }
        .thname {
          font-size: 13px;
          font-weight: 600;
          color: #ffffff;
          text-align: center;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .modebtn {
          background: rgba(255,255,255,0.08);
          border: none;
          cursor: pointer;
          width: 48px;
          height: 48px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          transition: all 0.2s ease;
        }
        .modebtn:hover {
          background: rgba(255,255,255,0.15);
        }
        .modeicon { --mdc-icon-size: 24px; }
        
        .popup {
          position: absolute;
          inset: 0;
          background: rgba(28,28,30,0.95);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.15s ease;
          z-index: 5;
          border-radius: inherit;
          flex-wrap: wrap;
          padding: 10px;
        }
        .popup.open {
          opacity: 1;
          pointer-events: auto;
        }
        .popup-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          background: rgba(255,255,255,0.06);
          border: 2px solid transparent;
          cursor: pointer;
          padding: 6px 8px;
          border-radius: 10px;
          font-size: 10px;
          color: #ffffff;
          min-width: 44px;
        }
        .popup-item:hover {
          background: rgba(255,255,255,0.12);
        }
        .popup-item ha-icon { --mdc-icon-size: 18px; }
        
        .temp-col {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          justify-content: center;
        }
        .capsule {
          display: flex;
          flex-direction: column;
          align-items: center;
          background: rgba(255,255,255,0.06);
          border-radius: 24px;
          padding: 6px;
          gap: 6px;
        }
        .capsule button {
          background: none;
          border: none;
          cursor: pointer;
          width: 34px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          border-radius: 16px;
          transition: background 0.15s ease;
        }
        .capsule button:hover {
          background: rgba(255,255,255,0.12);
        }
        .capsule button ha-icon { --mdc-icon-size: 16px; }
        .targettemp {
          font-size: 16px;
          font-weight: 700;
          color: #ffffff;
        }
        .targettemp .deg {
          font-size: 12px;
          font-weight: 400;
          opacity: 0.6;
        }
      </style>
    `;

    this._el = {
      track: this.shadowRoot.querySelector(".track"),
      dark: this.shadowRoot.querySelector(".darkfill"),
      light: this.shadowRoot.querySelector(".lightfill"),
      curtempVal: this.shadowRoot.querySelector(".curtemp-val"),
      curtempUnit: this.shadowRoot.querySelector(".curtemp-unit"),
      targettemp: this.shadowRoot.querySelector(".targettemp"),
      thname: this.shadowRoot.querySelector(".thname"),
      modebtn: this.shadowRoot.querySelector(".modebtn"),
      modeicon: this.shadowRoot.querySelector(".modeicon"),
      popup: this.shadowRoot.querySelector(".popup"),
      tint: this.shadowRoot.querySelector(".tint"),
      btnPlus: this.shadowRoot.querySelector(".btn-plus"),
      btnMinus: this.shadowRoot.querySelector(".btn-minus"),
    };

    this._el.modebtn.addEventListener("click", (e) => this._togglePopup(e));
    this._el.popup.addEventListener("click", (e) => {
      if (e.target === this._el.popup) {
        e.stopPropagation();
        this._popupOpen = false;
        this._renderPopup();
      }
    });
    this._el.btnPlus.addEventListener("click", (e) => this._changeTemp(1, e));
    this._el.btnMinus.addEventListener("click", (e) => this._changeTemp(-1, e));

    this._built = true;
  }

  _renderPopup() {
    if (!this._built || !this._stateObj) return;
    const stateObj = this._stateObj;
    const hvacMode = stateObj.state;
    const modes = stateObj.attributes.hvac_modes || [hvacMode];
    const el = this._el;

    el.popup.innerHTML = modes
      .map((m) => {
        const active = m === hvacMode;
        const c = MODE_COLORS[m] || FALLBACK_COLOR;
        const style = active
          ? `color:${c};border-color:${c};background:${c}26;`
          : "";
        return `
          <button class="popup-item" data-mode="${m}" style="${style}">
            <ha-icon icon="${MODE_ICONS[m] || "mdi:thermostat"}"></ha-icon>
            <span>${MODE_LABELS_TR[m] || m}</span>
          </button>
        `;
      })
      .join("");

    el.popup.classList.toggle("open", this._popupOpen);
    el.popup.querySelectorAll(".popup-item").forEach((btn) => {
      btn.addEventListener("click", (e) =>
        this._setHvacMode(btn.getAttribute("data-mode"), e)
      );
    });
  }

  _update() {
    if (!this._built || !this._stateObj) return;
    const stateObj = this._stateObj;
    const attrs = stateObj.attributes;
    const el = this._el;

    const hvacMode = stateObj.state;
    const hvacAction = attrs.hvac_action;
    const min = attrs.min_temp ?? 7;
    const max = attrs.max_temp ?? 35;
    const target = attrs.temperature;
    const current = attrs.current_temperature ?? target;

    const actionKey = (hvacAction || "").toLowerCase();
    const modeKey = (hvacMode || "").toLowerCase();
    const isActiveAction =
      actionKey && actionKey !== "idle" && actionKey !== "off" && ACTION_COLORS[actionKey];
    const color = isActiveAction
      ? ACTION_COLORS[actionKey]
      : MODE_COLORS[modeKey] || FALLBACK_COLOR;

    // Normalize değerler (0-1 arası)
    const fTarget = target != null && max > min ? (target - min) / (max - min) : 0;
    const fCurrent = current != null && max > min ? (current - min) / (max - min) : 0;

    // ===== ÇEMBERLERİ ÇİZ =====
    // Dark: Başlangıçtan current'e kadar
    el.dark.setAttribute("d", createArc(0, fCurrent));
    el.dark.style.stroke = color;
    el.dark.style.strokeOpacity = "1";

    // Light: Current'ten target'e kadar
    el.light.setAttribute("d", createArc(fCurrent, fTarget));
    el.light.style.stroke = color;
    el.light.style.strokeOpacity = "0.3";

    // Track zaten sabit

    const unit =
      (this._hass?.config?.unit_system?.temperature) ||
      attrs.temperature_unit ||
      "°C";

    // Güncelle
    el.curtempVal.textContent = current != null ? current.toFixed(1) : "--";
    el.curtempUnit.textContent = unit;
    el.targettemp.innerHTML =
      (target != null ? target.toFixed(1) : "--") +
      '<span class="deg">' + unit + '</span>';

    el.thname.textContent =
      this._config.name || attrs.friendly_name || this._config.entity;

    el.modebtn.style.color = color;
    el.modebtn.style.background = color + "26";
    el.modeicon.setAttribute("icon", MODE_ICONS[hvacMode] || "mdi:thermostat");

    el.tint.style.background = `radial-gradient(circle at 30% 40%, ${color}22, transparent 70%)`;

    this._renderPopup();
  }
}

customElements.define("aura-climate-card", AuraClimateCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "aura-climate-card",
  name: "Aura Climate Card",
  description: "Kompakt yaylı iklim/termostat kartı",
});
