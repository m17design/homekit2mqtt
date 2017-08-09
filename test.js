#!/usr/bin/env node

require('should');

const cp = require('child_process');
const path = require('path');
const streamSplitter = require('stream-splitter');
const Mqtt = require('mqtt');

mqtt = Mqtt.connect('mqtt://127.0.0.1');

const config = require('./example-homekit2mqtt.json');

const homekitCmd = path.join(__dirname, '/index.js');

function randomHex() {
    return ('0' + Math.floor(Math.random() * 0xff)).slice(-2);
}

const homekitArgs = ['-v', 'debug', '-a', 'CC:22:3D:' + randomHex() + ':' + randomHex() + ':' + randomHex()];
let homekit;
let homekitPipeOut;
let homekitPipeErr;
const homekitSubscriptions = {};
const homekitBuffer = [];

let subIndex = 0;

const clientCmd = path.join(__dirname, '/node_modules/.bin/hap-client-tool -d 127.0.0.1 -p 51826');
let clientAccs;


const mqttSubscriptions = {};
function mqttSubscribe(topic, callback) {
    if (mqttSubscriptions[topic]) {
        mqttSubscriptions[topic].push(callback);
        return mqttSubscriptions[topic] - 1;
    } else {
        mqttSubscriptions[topic] = [callback];
        mqtt.subscribe(topic);
        return 0;
    }
}
mqtt.on('message', (topic, payload) => {
    if (mqttSubscriptions[topic]) {
        mqttSubscriptions[topic].forEach((callback, index) => {
            callback(payload.toString());
        });
    }
});

function mqttUnsubscribe(topic, id) {
    mqttSubscriptions[topic].splice(id, 1);
}

function subscribe(type, rx, cb) {
    subIndex += 1;
    if (type === 'sim') {
        simSubscriptions[subIndex] = {rx, cb};
    } else if (type === 'homekit') {
        homekitSubscriptions[subIndex] = {rx, cb};
    }
    matchSubscriptions(type);
    return subIndex;
}

function unsubscribe(type, subIndex) {
    if (type === 'sim') {
        delete simSubscriptions[subIndex];
    } else if (type === 'homekit') {
        delete homekitSubscriptions[subIndex];
    }
}

function matchSubscriptions(type, data) {
    let subs;
    let buf;
    if (type === 'sim') {
        subs = simSubscriptions;
        buf = simBuffer;
    } else if (type === 'homekit') {
        subs = homekitSubscriptions;
        buf = homekitBuffer;
    }
    if (data) {
        buf.push(data);
    }
    buf.forEach((line, index) => {
        Object.keys(subs).forEach(key => {
            const sub = subs[key];
            if (line.match(sub.rx)) {
                sub.cb(line);
                delete subs[key];
                buf.splice(index, 1);
            }
        });
    });
}

function startHomekit() {
    homekit = cp.spawn(homekitCmd, homekitArgs);
    homekitPipeOut = homekit.stdout.pipe(streamSplitter('\n'));
    homekitPipeErr = homekit.stderr.pipe(streamSplitter('\n'));
    homekitPipeOut.on('token', data => {
        console.log('homekit', data.toString());
        matchSubscriptions('homekit', data.toString());
    });
    homekitPipeErr.on('token', data => {
        console.log('homekit', data.toString());
        matchSubscriptions('homekit', data.toString());
    });
}

function end(code) {
    if (homekit.kill) {
        homekit.kill();
    }
    if (typeof code !== 'undefined') {
        process.exit(code);
    }
}

process.on('SIGINT', () => {
    end(1);
});

process.on('exit', () => {
    end();
});

describe('start homekit2mqtt', () => {
    it('should start without error', function (done) {
        this.timeout(20000);
        subscribe('homekit', /homekit2mqtt [0-9.]+ starting/, () => {
            done();
        });
        startHomekit();
    });
    it('should create accessories', function (done) {
        subscribe('homekit', /hap created [0-9]+ Accessories/, () => {
            done();
        });
    });
    it('should announce the bridge', function (done) {
        subscribe('homekit', /hap publishing bridge/, () => {
            done();
        });
    });
    it('should listen on port 51826', function (done) {
        subscribe('homekit', /hap Bridge listening on port 51826/, () => {
            done();
        });
    });
});

describe('homekit2mqtt - mqtt connection', () => {
    it('homekit2mqtt should connect to the mqtt broker', function (done) {
        this.timeout(12000);
        subscribe('homekit', /mqtt connected/, () => {
            done();
        });
    });
    it('should publish connected=2 on mqtt', function (done) {
        mqttSubscribe('homekit/connected', function (payload) {
            if (payload === '2') {
                done();
            }
        });
    });
});

let aid = {};
let iid = {};

if (process.platform !== 'darwin') {
    describe('start dbus', function () {
        this.timeout(60000);
        it('should start dbus', done => {
            cp.exec('dbus-launch', (err, stdout, stderr) => {
                console.log('dbus err', err);
                console.log('dbus stdout', stdout);
                console.log('dbus stderr', stderr);
                setTimeout(done, 3000);
            });
        });
    });
}


describe('hap-client - homekit2mqtt connection', function () {
    this.timeout(180000);
    it('should pair without error', function (done)  {
        this.timeout(180000);
        subscribe('homekit', /hap paired/, () => {
            setTimeout(function () {
                done();
            }, 3000);
        });

        //console.log('--- trying to pair...');
        var pair = cp.spawn(path.join(__dirname, '/node_modules/.bin/hap-client-tool'), ['-d', '127.0.0.1', '-p', '51826', 'pair']);

        pair.on('close', (code) => {
            //console.log(`--- pair close - child process exited with code ${code}`);
        });
        pair.on('exit', (code) => {
            //console.log(`--- pair exit- child process exited with code ${code}`);
        });
        pair.on('error', (err) => {
            //console.log('--- pair error - Failed to start child process.', err);
        });
        pair.stdout.on('data', data => {
            data = data.toString();
            //console.log('pair stdout', data);
            if (data.match(/pin code/)) {
                //console.log('--- writing pin to stdin');
                pair.stdin.write('031-45-154\n');
                pair.stdin.write('\n');
            }
        });
        pair.stderr.on('data', data => {
            //console.log('pair stderr', data.toString());
        });

    });
    it('should be able to dump accessories', (done) => {
        cp.exec(clientCmd + ' dump', (err, stdout, stderr) => {
            const clientAccs = JSON.parse(stdout).accessories;

            clientAccs.forEach(acc => {
                let name;
                let iidTmp = {};

                acc.services.forEach(service => {
                    service.characteristics.forEach(ch => {
                        iidTmp[String(ch.Name).replace(/ /g, '')] = ch.iid;
                        if (ch.Name === 'Name') {
                            name = ch.value
                        }
                    });

                });
                aid[name] = acc.aid;
                iid[name] = iidTmp;
            });

            // add one because the bridge itself is also an accessory
            if (clientAccs.length === (Object.keys(config).length + 1)) {
                done();
            }
        });
    });
    it('should get the status of the switch', (done) => {
        cp.exec(clientCmd + ' get --aid ' + aid.Switch1 + ' --iid ' + iid.Switch1.On, (err, stdout, stderr) => {
            if (stdout === 'false\n') {
                done();
            }
        });
    });
});

describe('mqtt - homekit2mqtt - client', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(12000);
        subscribe('homekit', /hap update Switch1 On true/, () => {
            done();
        });
        mqtt.publish('Switch/status', '1');
    });
    it('client should get the status of the switch', (done) => {
        cp.exec(clientCmd + ' get --aid ' + aid.Switch1 + ' --iid ' + iid.Switch1.On, (err, stdout, stderr) => {
            if (stdout === 'true\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(12000);
        subscribe('homekit', /hap update Switch1 On false/, () => {
            done();
        });
        mqtt.publish('Switch/status', '0');
    });
    it('client should get the status of the switch', (done) => {
        cp.exec(clientCmd + ' get --aid ' + aid.Switch1 + ' --iid ' + iid.Switch1.On, (err, stdout, stderr) => {
            if (stdout === 'false\n') {
                done();
            }
        });
    });
});

describe('Switch', () => {
    it('homekit2mqtt should publish on mqtt after client did a set', (done) => {
        let id = mqttSubscribe('Switch/set', payload => {
            if (payload === '1') {
                mqttUnsubscribe('Switch/set', id);
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Switch1 + ' --iid ' + iid.Switch1.On + ' 1';
        console.log(cmd);
        cp.exec(cmd);
    });

    it('homekit2mqtt should publish on mqtt after client did a set', (done) => {
        mqttSubscribe('Switch/set', payload => {
            if (payload === '0') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Switch1 + ' --iid ' + iid.Switch1.On + ' 0';
        console.log(cmd);
        cp.exec(cmd);
    });

});

describe('TemperatureSensor', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(12000);
        subscribe('homekit', /hap update TemperatureSensor CurrentTemperature 21/, () => {
            done();
        });
        mqtt.publish('TemperatureSensor/Temperature', '21');
    });
    it('client should get the temperature', (done) => {
        cp.exec(clientCmd + ' get --aid ' + aid.TemperatureSensor + ' --iid ' + iid.TemperatureSensor.CurrentTemperature, (err, stdout, stderr) => {
            if (stdout === '21\n') {
                done();
            }
        });
    });
});

testLowBattery('TemperatureSensor');

describe('TemperatureSensor Fahrenheit', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(12000);
        subscribe('homekit', /hap update TemperatureSensorF CurrentTemperature 20/, () => {
            done();
        });
        mqtt.publish('TemperatureSensorF/Temperature', '68');
    });
    it('client should get the temperature', (done) => {
        cp.exec(clientCmd + ' get --aid ' + aid.TemperatureSensorF + ' --iid ' + iid.TemperatureSensorF.CurrentTemperature, (err, stdout, stderr) => {
            if (stdout === '20\n') {
                done();
            }
        });
    });
});

describe('ContactSensor ContactSensorState', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(12000);
        subscribe('homekit', /hap update ContactSensor ContactSensorState 1/, () => {
            done();
        });
        mqtt.publish('ContactSensor/status', '1');
    });
    it('client should get the status of the ContactSensor', (done) => {
        cp.exec(clientCmd + ' get --aid ' + aid.ContactSensor + ' --iid ' + iid.ContactSensor.ContactSensorState, (err, stdout, stderr) => {
            if (stdout === '1\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(12000);
        subscribe('homekit', /hap update ContactSensor ContactSensorState 0/, () => {
            done();
        });
        mqtt.publish('ContactSensor/status', '0');
    });
    it('client should get the status of the ContactSensor', (done) => {
        cp.exec(clientCmd + ' get --aid ' + aid.ContactSensor + ' --iid ' + iid.ContactSensor.ContactSensorState, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });
});

testLowBattery('ContactSensor');

describe('MotionSensor MotionSensorState', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(12000);
        subscribe('homekit', /hap update MotionSensor MotionDetected true/, () => {
            done();
        });
        mqtt.publish('MotionSensor/status', '1');
    });
    it('client should get the status of the MotionSensor', (done) => {
        cp.exec(clientCmd + ' get --aid ' + aid.MotionSensor + ' --iid ' + iid.MotionSensor.MotionDetected, (err, stdout, stderr) => {
            if (stdout === 'true\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(12000);
        subscribe('homekit', /hap update MotionSensor MotionDetected false/, () => {
            done();
        });
        mqtt.publish('MotionSensor/status', '0');
    });
    it('client should get the status of the MotionSensor', (done) => {
        cp.exec(clientCmd + ' get --aid ' + aid.MotionSensor + ' --iid ' + iid.MotionSensor.MotionDetected, (err, stdout, stderr) => {
            if (stdout === 'false\n') {
                done();
            }
        });
    });
});

testLowBattery('MotionSensor');

describe('SmokeSensor SmokeSensorState', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(12000);
        subscribe('homekit', /hap update SmokeSensor SmokeDetected 1/, () => {
            done();
        });
        mqtt.publish('SmokeSensor/status', '1');
    });
    it('client should get the status of the SmokeSensor', (done) => {
        cp.exec(clientCmd + ' get --aid ' + aid.SmokeSensor + ' --iid ' + iid.SmokeSensor.SmokeDetected, (err, stdout, stderr) => {
            if (stdout === '1\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(12000);
        subscribe('homekit', /hap update SmokeSensor SmokeDetected 0/, () => {
            done();
        });
        mqtt.publish('SmokeSensor/status', '0');
    });
    it('client should get the status of the SmokeSensor', (done) => {
        cp.exec(clientCmd + ' get --aid ' + aid.SmokeSensor + ' --iid ' + iid.SmokeSensor.SmokeDetected, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });
});

testLowBattery('SmokeSensor');

describe('CarbonMonoxideSensor CarbonMonoxideSensorState', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(12000);
        subscribe('homekit', /hap update CarbonMonoxideSensor CarbonMonoxideDetected 1/, () => {
            done();
        });
        mqtt.publish('CarbonMonoxideSensor/status', '1');
    });
    it('client should get the status of the CarbonMonoxideSensor', (done) => {
        cp.exec(clientCmd + ' get --aid ' + aid.CarbonMonoxideSensor + ' --iid ' + iid.CarbonMonoxideSensor.CarbonMonoxideDetected, (err, stdout, stderr) => {
            if (stdout === '1\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(12000);
        subscribe('homekit', /hap update CarbonMonoxideSensor CarbonMonoxideDetected 0/, () => {
            done();
        });
        mqtt.publish('CarbonMonoxideSensor/status', '0');
    });
    it('client should get the status of the CarbonMonoxideSensor', (done) => {
        cp.exec(clientCmd + ' get --aid ' + aid.CarbonMonoxideSensor + ' --iid ' + iid.CarbonMonoxideSensor.CarbonMonoxideDetected, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });
});

testLowBattery('CarbonMonoxideSensor');

describe('CarbonDioxideSensor CarbonDioxideSensorState', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(12000);
        subscribe('homekit', /hap update CarbonDioxideSensor CarbonDioxideDetected 1/, () => {
            done();
        });
        mqtt.publish('CarbonDioxideSensor/status', '1');
    });
    it('client should get the status of the CarbonDioxideSensor', (done) => {
        cp.exec(clientCmd + ' get --aid ' + aid.CarbonDioxideSensor + ' --iid ' + iid.CarbonDioxideSensor.CarbonDioxideDetected, (err, stdout, stderr) => {
            if (stdout === '1\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(12000);
        subscribe('homekit', /hap update CarbonDioxideSensor CarbonDioxideDetected 0/, () => {
            done();
        });
        mqtt.publish('CarbonDioxideSensor/status', '0');
    });
    it('client should get the status of the CarbonDioxideSensor', (done) => {
        cp.exec(clientCmd + ' get --aid ' + aid.CarbonDioxideSensor + ' --iid ' + iid.CarbonDioxideSensor.CarbonDioxideDetected, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });
});

testLowBattery('CarbonDioxideSensor');

describe('LeakSensor LeakSensorState', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(12000);
        subscribe('homekit', /hap update LeakSensor LeakDetected 1/, () => {
            done();
        });
        mqtt.publish('LeakSensor/status', '1');
    });
    it('client should get the status of the LeakSensor', (done) => {
        cp.exec(clientCmd + ' get --aid ' + aid.LeakSensor + ' --iid ' + iid.LeakSensor.LeakDetected, (err, stdout, stderr) => {
            if (stdout === '1\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(12000);
        subscribe('homekit', /hap update LeakSensor LeakDetected 0/, () => {
            done();
        });
        mqtt.publish('LeakSensor/status', '0');
    });
    it('client should get the status of the LeakSensor', (done) => {
        cp.exec(clientCmd + ' get --aid ' + aid.LeakSensor + ' --iid ' + iid.LeakSensor.LeakDetected, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });
});

testLowBattery('LeakSensor');

function testLowBattery(name) {
    describe(name + ' StatusLowBattery', () => {
        it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
            this.timeout(12000);
            subscribe('homekit', new RegExp('hap update ' + name + ' StatusLowBattery 1'), () => {
                done();
            });
            mqtt.publish(name + '/status/LowBattery', '{"val":1}');
        });
        it('client should get the status of the ' + name, (done) => {
            cp.exec(clientCmd + ' get --aid ' + aid[name] + ' --iid ' + iid[name].StatusLowBattery, (err, stdout, stderr) => {
                if (stdout === '1\n') {
                    done();
                }
            });
        });
        it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
            this.timeout(12000);
            subscribe('homekit', new RegExp('hap update ' + name + ' StatusLowBattery 0'), () => {
                done();
            });
            mqtt.publish(name + '/status/LowBattery', '{"val":0}');
        });
        it('client should get the status of the MotionSensor', (done) => {
            cp.exec(clientCmd + ' get --aid ' + aid[name] + ' --iid ' + iid[name].StatusLowBattery, (err, stdout, stderr) => {
                if (stdout === '0\n') {
                    done();
                }
            });
        });
    });
}

setTimeout(() => {
    homekit.kill();
    process.exit(1);
}, 30000);
