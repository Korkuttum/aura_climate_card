/*
 * Aura Climate Card
 * Compact 240-degree arc climate/thermostat card for Home Assistant Lovelace.
 * Built for Korkuttum.
 *
 * Usage (Lovelace YAML):
 *   type: custom:aura-climate-card
 *   entity: climate.your_thermostat
 *   name: Oturma Odasi        # optional, defaults to entity friendly_name
 *   grid_options:
 *     columns: 6
 *     rows: 2
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

const R = 54;
const CX = 40;
const CY = 70;
const SWEEP = (4 * Math.PI) / 3; // 240 degrees
const PHI_START = (2 * Math.PI) / 3;

function pointFor(fraction) {
  const f = Math.max(0, Math.min(1, fraction));
  const phi = PHI_START - f * SWEEP;
  return { x: CX + R * Math.cos(phi), y: CY + R * Math.sin(phi) };
}

function arcSegment(f0, f1) {
  const lo = Math.min(f0, f1);
  const hi = Math.max(f0, f1);
  if (hi - lo < 0.001) return "";
  const p0 = pointFor(lo);
  const p1 = pointFor(hi);
  const largeArc = hi - lo > 0.75 ? 1 : 0;
  return (
    "M " + p0.x.toFixed(2) + " " + p0.y.toFixed(2) +
    " A " + R + " " + R + " 0 " + largeArc + " 0 " +
    p1.x.toFixed(2) + " " + p1.y.toFixed(2)
  );
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
    this._lastParticleMode = null;
    this._boundOutsideClick = this._handleOutsideClick.bind(this);
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error('Lutfen bir "entity" tanimlayin (orn. climate.oturma_odasi)');
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

  getCardSize() {
    return 2;
  }

  getGridOptions() {
    return {
      columns: 6,
      rows: 2,
      min_columns: 4,
      max_columns: 12,
    };
  }

  static getStubConfig() {
    return { entity: "" };
  }

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
          <div class="particles">
            <div class="snow-layer"></div>
            <div class="ember-layer"></div>
          </div>
          <div class="tint"></div>
          <div class="content">
            <div class="wrap">
              <div class="arc-col">
                <div class="arc-inner">
                  <svg class="arc-svg" viewBox="0 0 108 140">
                    <path class="track" d="" />
                    <path class="lightfill" d="" />
                    <path class="darkfill" d="" />
                  </svg>
                  <div class="curtemp"></div>
                </div>
              </div>
              <div class="mode-col">
                <div class="thname"></div>
                <button class="modebtn"><ha-icon class="modeicon"></ha-icon></button>
              </div>
              <div class="temp-col">
                <div class="capsule">
                  <button class="btn-plus"><ha-icon icon="mdi:plus"></ha-icon></button>
                  <div class="targettemp"></div>
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
          padding: 8px 10px;
          overflow: hidden;
          border-radius: var(--ha-card-border-radius, 12px);
        }
        .particles, .tint {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 0;
          overflow: hidden;
        }
        .tint { transition: background 0.3s ease; }
        .content { position: relative; z-index: 1; height: 100%; box-sizing: border-box; }
        .thname {
          font-size: 12px;
          font-weight: 600;
          color: #ffffff;
          line-height: 1.15;
          text-align: center;
          max-width: 90px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .wrap {
          display: grid;
          grid-template-columns: 1fr 72px 1fr;
          align-items: center;
          gap: 10px;
          height: 100%;
          padding: 0 14px;
          box-sizing: border-box;
        }
        .arc-col {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: flex-start;
          height: 100%;
          min-width: 0;
        }
        .arc-inner {
          position: relative;
          width: 100%;
          height: 100%;
        }
        .arc-svg {
          width: 100%;
          height: 100%;
          object-fit: contain;
          display: block;
        }
        .track {
          fill: none;
          stroke: #555;
          opacity: 0.35;
          stroke-width: 13;
          stroke-linecap: round;
        }
        .lightfill, .darkfill {
          fill: none;
          stroke-width: 13;
          stroke-linecap: round;
          transition: d 0.15s ease, stroke 0.15s ease, stroke-opacity 0.15s ease;
        }
        .curtemp {
          position: absolute;
          top: 50%;
          left: 37.03%;
          transform: translate(-50%, -50%);
          font-size: 17px;
          font-weight: 600;
          color: #ffffff;
          line-height: 1;
          text-align: center;
          white-space: nowrap;
        }
        .curtemp .deg { font-size: 11px; font-weight: 400; opacity: 0.7; }
        .mode-col {
          position: relative;
          height: 100%;
          width: 100%;
          display: grid;
          grid-template-rows: 1fr auto 1fr;
          justify-items: center;
          gap: 4px;
        }
        .mode-col .thname {
          grid-row: 1;
          align-self: end;
          width: 100%;
          max-width: 100%;
        }
        .mode-col .modebtn {
          grid-row: 2;
        }
        .modebtn {
          background: rgba(255,255,255,0.08);
          border: none;
          cursor: pointer;
          width: 44px;
          height: 44px;
          min-width: 44px;
          min-height: 44px;
          flex-shrink: 0;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
        }
        .modeicon { --mdc-icon-size: 22px; }
        .popup {
          position: absolute;
          inset: 0;
          background: rgba(28,28,30,0.94);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.15s ease;
          z-index: 5;
          border-radius: inherit;
        }
        .popup.open {
          opacity: 1;
          pointer-events: auto;
        }
        .popup-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          background: rgba(255,255,255,0.06);
          border: 2px solid transparent;
          cursor: pointer;
          width: 52px;
          padding: 7px 0 5px;
          border-radius: 12px;
          font-size: 10px;
          color: #ffffff;
        }
        .popup-item:hover { background: rgba(255,255,255,0.12); }
        .popup-item ha-icon { --mdc-icon-size: 20px; }
        .temp-col {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          justify-content: center;
          min-width: 0;
        }
        .capsule {
          display: flex;
          flex-direction: column;
          align-items: center;
          background: rgba(255,255,255,0.06);
          border-radius: 22px;
          padding: 4px;
          gap: 7px;
        }
        .capsule button {
          background: none;
          border: none;
          cursor: pointer;
          width: 32px;
          height: 26px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          border-radius: 16px;
        }
        .capsule button:hover { background: rgba(255,255,255,0.12); }
        .capsule button ha-icon { --mdc-icon-size: 16px; }
        .targettemp {
          font-size: 15px;
          font-weight: 700;
          color: #ffffff;
        }
        .targettemp .deg { font-size: 11px; font-weight: 400; opacity: 0.7; }

        @keyframes snowfall {
          0% { transform: translate(0,-8px) rotate(0deg); opacity: 0; }
          12% { opacity: .6; }
          30% { transform: translate(16px,25px) rotate(90deg); }
          50% { transform: translate(-14px,55px) rotate(180deg); }
          70% { transform: translate(12px,80px) rotate(270deg); }
          100% { transform: translate(-6px,116px) rotate(360deg); opacity: 0; }
        }
        @keyframes emberflicker {
          0% { transform: translate(0,6px) scale(.5); opacity: 0; }
          20% { opacity: .75; transform: translate(3px,-14px) scale(1.1); }
          50% { transform: translate(-3px,-45px) scale(.8); opacity: .55; }
          75% { transform: translate(4px,-75px) scale(1); opacity: .4; }
          100% { transform: translate(-2px,-112px) scale(.3); opacity: 0; }
        }
        .snowp {
          position: absolute;
          bottom: 0;
          color: #cfe8ff;
          animation: snowfall linear infinite;
          --mdc-icon-size: 10px;
        }
        .emberp {
          position: absolute;
          bottom: 0;
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: #ffa94d;
          box-shadow: 0 0 4px #ffa94d;
          animation: emberflicker ease-in infinite;
        }
        .snow-layer.hidden, .ember-layer.hidden { display: none; }
      </style>
    `;

    this._el = {
      root: this.shadowRoot,
      track: this.shadowRoot.querySelector(".track"),
      light: this.shadowRoot.querySelector(".lightfill"),
      dark: this.shadowRoot.querySelector(".darkfill"),
      curtemp: this.shadowRoot.querySelector(".curtemp"),
      targettemp: this.shadowRoot.querySelector(".targettemp"),
      thname: this.shadowRoot.querySelector(".thname"),
      modebtn: this.shadowRoot.querySelector(".modebtn"),
      modeicon: this.shadowRoot.querySelector(".modeicon"),
      popup: this.shadowRoot.querySelector(".popup"),
      tint: this.shadowRoot.querySelector(".tint"),
      snowLayer: this.shadowRoot.querySelector(".snow-layer"),
      emberLayer: this.shadowRoot.querySelector(".ember-layer"),
      btnPlus: this.shadowRoot.querySelector(".btn-plus"),
      btnMinus: this.shadowRoot.querySelector(".btn-minus"),
    };

    let snowHtml = "";
    for (let i = 0; i < 7; i++) {
      const left = 5 + Math.random() * 90;
      const dur = (3.5 + Math.random() * 2.5).toFixed(2);
      const delay = (Math.random() * 3.5).toFixed(2);
      const size = Math.round(8 + Math.random() * 4);
      snowHtml += `<ha-icon class="snowp" icon="mdi:snowflake" style="left:${left}%;--mdc-icon-size:${size}px;animation-duration:${dur}s;animation-delay:${delay}s;"></ha-icon>`;
    }
    this._el.snowLayer.innerHTML = snowHtml;

    let emberHtml = "";
    for (let i = 0; i < 8; i++) {
      const left = 8 + Math.random() * 84;
      const dur = (2 + Math.random() * 1.8).toFixed(2);
      const delay = (Math.random() * 3).toFixed(2);
      emberHtml += `<span class="emberp" style="left:${left}%;animation-duration:${dur}s;animation-delay:${delay}s;"></span>`;
    }
    this._el.emberLayer.innerHTML = emberHtml;

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

    const fTarget = target != null && max > min ? (target - min) / (max - min) : 0;
    const fCurrent = current != null && max > min ? (current - min) / (max - min) : 0;
    const isCooling = modeKey === "cool";

    el.track.setAttribute("d", arcSegment(0, 1));
    if (isCooling) {
      el.dark.setAttribute("d", arcSegment(fCurrent, 1));
      el.light.setAttribute("d", arcSegment(fTarget, fCurrent));
    } else {
      el.dark.setAttribute("d", arcSegment(0, fCurrent));
      el.light.setAttribute("d", arcSegment(fCurrent, fTarget));
    }
    el.light.style.stroke = color;
    el.light.style.strokeOpacity = "0.28";
    el.dark.style.stroke = color;
    el.dark.style.strokeOpacity = "1";

    el.curtemp.innerHTML =
      (current != null ? current.toFixed(1) : "--") + '<span class="deg">°</span>';
    el.targettemp.innerHTML =
      (target != null ? target.toFixed(1) : "--") + '<span class="deg">°</span>';

    el.thname.textContent =
      this._config.name || attrs.friendly_name || this._config.entity;

    el.modebtn.style.color = color;
    el.modebtn.style.background = color + "26";
    el.modeicon.setAttribute("icon", MODE_ICONS[hvacMode] || "mdi:thermostat");

    el.tint.style.background = `radial-gradient(circle at 30% 40%, ${color}22, transparent 70%)`;

    const particleMode = modeKey === "cool" ? "cool" : modeKey === "heat" ? "heat" : "none";
    if (particleMode !== this._lastParticleMode) {
      el.snowLayer.classList.toggle("hidden", particleMode !== "cool");
      el.emberLayer.classList.toggle("hidden", particleMode !== "heat");
      this._lastParticleMode = particleMode;
    }

    this._renderPopup();
  }
}

customElements.define("aura-climate-card", AuraClimateCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "aura-climate-card",
  name: "Aura Climate Card",
  description: "Kompakt, 240 derece yaylı iklim/termostat kartı.",
});
