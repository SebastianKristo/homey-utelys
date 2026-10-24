'use strict';

const Homey = require('homey');

class StatusDriver extends Homey.Driver {

  async onPairListDevices() {
    return [{ name: 'Utelys', data: { id: 'utelys-status' } }];
  }

}

module.exports = StatusDriver;
