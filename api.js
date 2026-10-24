'use strict';

module.exports = {
  async getDevices({ homey }) { return homey.app.listLightDevices(); },
  async getStatus({ homey }) { return homey.app.getStatus(); },
  async test({ homey, body }) { return homey.app.setLights(!!body.on, 'test'); },
};
