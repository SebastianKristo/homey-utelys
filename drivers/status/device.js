'use strict';

const Homey = require('homey');

class StatusDevice extends Homey.Device {

  async onInit() {
    this.registerCapabilityListener('onoff', value => this.homey.app.setLights(value, 'device'));
    this.registerCapabilityListener('automation_enabled', value => this.homey.app.setEnabled(value));
    await this.homey.app.updateStatusDevices().catch(this.error);
  }

  async update(s) {
    const set = (cap, v) => (this.getCapabilityValue(cap) !== v ? this.setCapabilityValue(cap, v).catch(this.error) : null);
    await Promise.all([
      set('onoff', s.lightsOn),
      set('automation_enabled', s.enabled),
      set('is_dark', s.dark),
      set('measure_luminance', Math.round(s.estimatedLux)),
      set('measure_luminance.sensor', s.lux != null ? Math.round(s.lux) : null),
      set('sun_altitude', Math.round(s.altitude * 10) / 10),
      set('next_on', s.nextOnText),
      set('next_off', s.nextOffText),
    ]);
  }

}

module.exports = StatusDevice;
