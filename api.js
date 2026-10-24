'use strict';

module.exports = {
  async getDevices({ homey }) { return homey.app.listLightDevices(); },
  async zones({ homey }) { return homey.app.listZones(); },
  async getStatus({ homey }) { return homey.app.getStatus(); },
  async test({ homey, body }) { return homey.app.setLights(!!body.on, 'test'); },
};
