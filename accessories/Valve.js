/* eslint unicorn/filename-case: "off", func-names: "off", camelcase: "off", no-unused-vars: "off" */

module.exports = function (iface) {
    const {mqttPub, mqttSub, mqttStatus, log, newAccessory, Service, Characteristic} = iface;

    /*
    Service.Valve = function(displayName, subtype) {
    Service.call(this, displayName, '000000D0-0000-1000-8000-0026BB765291', subtype);

    // Required Characteristics
    this.addCharacteristic(Characteristic.Active);
    this.addCharacteristic(Characteristic.InUse);
    this.addCharacteristic(Characteristic.ValveType);

    // The value property of ValveType must be one of the following:
    Characteristic.ValveType.GENERIC_VALVE = 0;
    Characteristic.ValveType.IRRIGATION = 1;
    Characteristic.ValveType.SHOWER_HEAD = 2;
    Characteristic.ValveType.WATER_FAUCET = 3;

    // Optional Characteristics
    this.addOptionalCharacteristic(Characteristic.SetDuration);
    this.addOptionalCharacteristic(Characteristic.RemainingDuration);
    this.addOptionalCharacteristic(Characteristic.IsConfigured);
    this.addOptionalCharacteristic(Characteristic.ServiceLabelIndex);
    this.addOptionalCharacteristic(Characteristic.StatusFault);
    this.addOptionalCharacteristic(Characteristic.Name);
     */

    return function createAccessory_Valve(settings) {
        const valve = newAccessory(settings);

        if (typeof settings.payload.activeTrue === 'undefined') {
            settings.payload.activeTrue = true;
        }

        if (typeof settings.payload.inUseTrue === 'undefined') {
            settings.payload.inUseTrue = true;
        }

        if (typeof settings.payload.faultTrue === 'undefined') {
            settings.payload.faultTrue = true;
        }

        if (typeof settings.payload.activeFalse === 'undefined') {
            settings.payload.activeFalse = false;
        }

        valve.addService(Service.Valve, settings.name)
            .getCharacteristic(Characteristic.Active)
            .on('set', (value, callback) => {
                log.debug('< hap set', settings.name, 'Active', value);
                const active = value ? settings.payload.activeTrue : settings.payload.activeFalse;
                log.debug('> mqtt', settings.topic.setActive, active);
                mqttPub(settings.topic.setActive, active);
                callback();
            });

        const type = settings.config.valveType || 0;
        log.debug('> hap set', settings.name, 'ValveType', type);
        valve.getService(Service.Valve)
            .setCharacteristic(Characteristic.ValveType, type);

        /* istanbul ignore else  */
        if (settings.topic.statusActive) {
            mqttSub(settings.topic.statusActive, val => {
                log.debug('< mqtt', settings.topic.statusActive, val);
                const active = mqttStatus[settings.topic.statusActive] === settings.payload.activeTrue ? 1 : 0;
                log.debug('> hap update', settings.name, 'Active', active);
                valve.getService(Service.Valve)
                    .updateCharacteristic(Characteristic.Active, active);
            });
            valve.getService(Service.Valve)
                .getCharacteristic(Characteristic.Active)
                .on('get', callback => {
                    log.debug('< hap get', settings.name, 'Active');
                    const active = mqttStatus[settings.topic.statusActive] === settings.payload.activeTrue ? 1 : 0;
                    log.debug('> hap re_get', settings.name, 'Active', active);
                    callback(null, active);
                });
        }

        mqttSub(settings.topic.statusInUse, val => {
            log.debug('< mqtt', settings.topic.statusInUse, val);
            const inUse = mqttStatus[settings.topic.statusInUse] === settings.payload.inUseTrue ? 1 : 0;
            log.debug('> hap update', settings.name, 'InUse', inUse);
            valve.getService(Service.Valve)
                .updateCharacteristic(Characteristic.InUse, inUse);
        });
        valve.getService(Service.Valve)
            .getCharacteristic(Characteristic.InUse)
            .on('get', callback => {
                log.debug('< hap get', settings.name, 'InUse');
                const inUse = mqttStatus[settings.topic.statusInUse] === settings.payload.inUseTrue ? 1 : 0;
                log.debug('> hap re_get', settings.name, 'InUse', inUse);
                callback(null, inUse);
            });

        if (settings.topic.setDuration) {
            valve.getService(Service.Valve, settings.name)
                .getCharacteristic(Characteristic.SetDuration)
                .on('set', (value, callback) => {
                    log.debug('< hap set', settings.name, 'SetDuration', value);
                    log.debug('> mqtt', settings.topic.setDuration, value);
                    mqttPub(settings.topic.setDuration, value);
                    callback();
                });
        }

        /* istanbul ignore else  */
        if (settings.topic.statusRemainingDuration) {
            mqttSub(settings.topic.statusRemainingDuration, val => {
                log.debug('< mqtt', settings.topic.statusRemainingDuration, val);
                const remainingDuration = mqttStatus[settings.topic.statusRemainingDuration];
                log.debug('> hap update', settings.name, 'RemainingDuration', remainingDuration);
                valve.getService(Service.Valve)
                    .updateCharacteristic(Characteristic.RemainingDuration, remainingDuration);
            });
            valve.getService(Service.Valve)
                .getCharacteristic(Characteristic.RemainingDuration)
                .on('get', callback => {
                    log.debug('< hap get', settings.name, 'RemainingDuration');
                    const inUse = mqttStatus[settings.topic.statusRemainingDuration];
                    log.debug('> hap re_get', settings.name, 'RemainingDuration', inUse);
                    callback(null, inUse);
                });
        }

        /* istanbul ignore else  */
        if (settings.topic.statusFault) {
            mqttSub(settings.topic.statusFault, val => {
                log.debug('< mqtt', settings.topic.statusFault, val);
                const fault = mqttStatus[settings.topic.statusFault] === settings.payload.faultTrue ? 1 : 0;
                log.debug('> hap update', settings.name, 'StatusFault', fault);
                valve.getService(Service.Valve)
                    .updateCharacteristic(Characteristic.StatusFault, fault);
            });
            valve.getService(Service.Valve)
                .getCharacteristic(Characteristic.StatusFault)
                .on('get', callback => {
                    log.debug('< hap get', settings.name, 'StatusFault');
                    const fault = mqttStatus[settings.topic.statusFault] === settings.payload.faultTrue ? 1 : 0;
                    log.debug('> hap re_get', settings.name, 'StatusFault', fault);
                    callback(null, fault);
                });
        }

        return valve;
    };
};
