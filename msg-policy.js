/* NOVA Rx — MSG-03 messaging policy settings (pure logic, no DOM, no network, frontend/local only).
   Local settings: customer opt-in, templates, country/channel sending windows, spend limits.
   Campaigns and automatic sends are OFF by default and need an explicit grant (setting + opts.can permission).
   This module only DECIDES (check()) and records local spend; it never calls a channel API.
   Works as <script> (window.NovaMsgPolicy) and Node. Not wired to a screen yet. */
(function (root) {
  'use strict';
  var CHANNELS = ['sms', 'whatsapp', 'email'];
  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function mins(hhmm) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm)); if (!m || +m[1] > 24 || +m[2] > 59) fail('bad-time'); return +m[1] * 60 + +m[2]; }
  function defaults() {
    return { optIn: {}, templates: {}, windows: {}, limits: { perMessage: 0, daily: 0, monthly: 0 },
      campaigns: { enabled: false, grantedBy: null }, autoSend: { enabled: false, grantedBy: null }, spend: {} };
  }

  /* opts: {storage:{getItem,setItem}, key, can(action) default deny, now()}. */
  function createPolicy(opts) {
    opts = opts || {};
    var can = opts.can || function () { return false; };
    var now = opts.now || function () { return new Date(); };
    var store = opts.storage, key = opts.key || 'nova.msgPolicy';
    var s = defaults();
    if (store) { try { var raw = store.getItem(key); if (raw) s = Object.assign(defaults(), JSON.parse(raw)); } catch (e) { s = defaults(); } }
    function save() { if (store) store.setItem(key, JSON.stringify(s)); }
    function admin() { if (!can('messaging.settings')) fail('not-permitted'); }
    function chan(c) { if (CHANNELS.indexOf(c) < 0) fail('bad-channel'); return c; }

    function setOptIn(customerId, channel, value, source) {
      admin(); if (!customerId) fail('bad-customer'); chan(channel);
      var o = s.optIn[customerId] = s.optIn[customerId] || {};
      if (value === true) { if (!source) fail('opt-in-needs-source'); o[channel] = { at: now().toISOString(), source: String(source) }; }
      else delete o[channel];
      save();
    }
    function hasOptIn(customerId, channel) { return !!(s.optIn[customerId] && s.optIn[customerId][channel]); }

    /* Template body uses {name} placeholders; marketing templates are blocked unless campaigns are granted. */
    function setTemplate(id, t) {
      admin(); if (!id || !t || !t.body || !String(t.body).trim()) fail('bad-template');
      s.templates[id] = { channel: chan(t.channel), body: String(t.body), kind: t.kind === 'marketing' ? 'marketing' : 'service' };
      save();
    }
    function render(id, vars) {
      var t = s.templates[id]; if (!t) fail('template-not-found');
      vars = vars || {};
      return t.body.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] == null ? '' : String(vars[k]); });
    }

    /* window: {from:'09:00', to:'21:00', utcOffsetMin}; from>to means overnight. Key: COUNTRY/channel or COUNTRY/*. */
    function setWindow(country, channel, w) {
      admin(); if (!country) fail('bad-country'); if (channel !== '*') chan(channel);
      mins(w.from); mins(w.to);
      s.windows[String(country).toUpperCase() + '/' + channel] = { from: w.from, to: w.to, utcOffsetMin: +w.utcOffsetMin || 0 };
      save();
    }
    function inWindow(country, channel, at) {
      var k = String(country).toUpperCase(), w = s.windows[k + '/' + channel] || s.windows[k + '/*'];
      if (!w) return false; // no window configured = closed (fail-closed)
      var d = at || now(), m = ((d.getUTCHours() * 60 + d.getUTCMinutes() + w.utcOffsetMin) % 1440 + 1440) % 1440;
      var a = mins(w.from), b = mins(w.to);
      return a <= b ? (m >= a && m < b) : (m >= a || m < b);
    }

    function setLimits(l) {
      admin();
      ['perMessage', 'daily', 'monthly'].forEach(function (k) { var v = l[k]; if (v != null && !(v >= 0)) fail('bad-limit'); if (v != null) s.limits[k] = +v; });
      save();
    }
    function spent(d) {
      d = d || now(); var day = d.toISOString().slice(0, 10), mon = day.slice(0, 7), a = 0, b = 0;
      for (var k in s.spend) { if (k === day) a = s.spend[k]; if (k.slice(0, 7) === mon) b += s.spend[k]; }
      return { day: a, month: b };
    }

    /* Explicit grants: both the setting and the grantor's permission are required; revoke is immediate. */
    function grant(what, on) {
      if (what !== 'campaigns' && what !== 'autoSend') fail('bad-grant');
      if (!can('messaging.' + what + '.grant')) fail('not-permitted');
      s[what] = on ? { enabled: true, grantedBy: opts.actor || 'unknown' } : { enabled: false, grantedBy: null };
      save();
    }

    /* msg: {customerId, channel, country, templateId, mode:'manual'|'auto'|'campaign', cost}. Returns {allowed, reason}. */
    function check(msg) {
      msg = msg || {};
      var deny = function (r) { return { allowed: false, reason: r }; };
      if (CHANNELS.indexOf(msg.channel) < 0) return deny('bad-channel');
      var t = s.templates[msg.templateId], mode = msg.mode || 'manual';
      if (!t) return deny('template-not-found');
      if (t.channel !== msg.channel) return deny('template-channel-mismatch');
      if (mode === 'campaign' && !(s.campaigns.enabled && can('messaging.campaign.run'))) return deny('campaigns-not-permitted');
      if (mode === 'auto' && !(s.autoSend.enabled && can('messaging.autoSend.run'))) return deny('auto-send-not-permitted');
      if (mode !== 'manual' && mode !== 'auto' && mode !== 'campaign') return deny('bad-mode');
      if (t.kind === 'marketing' && mode !== 'campaign') return deny('marketing-needs-campaign');
      if (!hasOptIn(msg.customerId, msg.channel)) return deny('no-opt-in');
      if (!msg.country || !inWindow(msg.country, msg.channel)) return deny('outside-window');
      var cost = +msg.cost || 0, L = s.limits, sp = spent();
      if (L.perMessage > 0 && cost > L.perMessage) return deny('per-message-limit');
      if (L.daily > 0 && sp.day + cost > L.daily) return deny('daily-limit');
      if (L.monthly > 0 && sp.month + cost > L.monthly) return deny('monthly-limit');
      return { allowed: true, reason: 'ok' };
    }
    /* Records local spend for a message the caller actually sent through its own (separate) channel layer. */
    function recordSpend(cost) {
      var day = now().toISOString().slice(0, 10); s.spend[day] = (s.spend[day] || 0) + (+cost || 0); save();
    }

    return { setOptIn: setOptIn, hasOptIn: hasOptIn, setTemplate: setTemplate, render: render, setWindow: setWindow, inWindow: inWindow,
      setLimits: setLimits, grant: grant, check: check, recordSpend: recordSpend, spent: spent, snapshot: function () { return clone(s); } };
  }

  var api = { createPolicy: createPolicy, CHANNELS: CHANNELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaMsgPolicy = api;
})(typeof window !== 'undefined' ? window : this);
