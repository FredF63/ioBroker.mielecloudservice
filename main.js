/* jshint -W097 */
/* jshint -W030 */
/* jshint strict:true */
/* jslint esversion: 6 */
/* jslint node: true */
/**
*
* mieleCloudService Adapter for ioBroker
*
*/
'use strict';

// you have to require the utils module and call adapter function
const BaseURL = 'https://api.mcs3.miele.com/';
const adapterName = require('./package.json').name.split('.').pop();
const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const axios = require('axios');
const oauth = require('axios-oauth-client');
const salt = 'Zgfr56gFe87jJOM';
const START = 1;
const STOP  = 2;
const PAUSE = 3;
const START_SUPERFREEZING = 4;
const STOP_SUPERFREEZING  = 5;
const START_SUPERCOOLING  = 6;
const STOP_SUPERCOOLING   = 7;
const LIGHT_ON  = 1;
const LIGHT_OFF = 2;
// Global Variables
let adapter;
let auth;
let pollTimeout;
let expiryDate;

function startadapter(options) {
    options = options || {};
    Object.assign(options, {
        // name has to be set and has to be equal to adapters folder name and main file name excluding extension
        name: adapterName,
        // is called when adapter shuts down - callback has to be called under any circumstances!
        unload: function (callback) {
            try {
                if (pollTimeout) {
                    adapter.log.info('Clearing Timeout: pollTimeout');
                    clearTimeout(pollTimeout);
                }
                adapter.unsubscribeObjects('*');
                adapter.unsubscribeStates('*');
                adapter.setState('info.connection', false);
                if (auth.refresh_token) {
                    APILogOff(auth, "refresh_token")
                }
                if (auth.access_token) {
                    APILogOff(auth, "access_token")
                }
                adapter.log.info('Unloading MieleCloudService...');
                callback();
            } catch (e) {
                callback();
            }
        },
        // is called if a subscribed object changes
        /*
        objectChange: function (id, obj) {
            // Warning, obj can be null if it was deleted
            ADAPTER.log.debug('objectChange ' + id + ' ' + JSON.stringify(obj));
        },
         */
        // is called if a subscribed state changes
        stateChange: function (id, state) {
            // Warning, state can be null if it was deleted
            if (state && !state.ack) {
              adapter.log.debug('ack is not set!');
              // you can use the ack flag to detect if it is status (true) or command (false)
              adapter.log.debug('stateChange [' + id + '] [' + JSON.stringify(state)+']');
              let action = id.split('.').pop();
              APIStartAction(auth, id, action, state.val);
            }
          },
        // stateChange: function(id, state){
        //    ADAPTER.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));
        // },
        // Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
        message: function (obj) {
            if (typeof obj === 'object' && obj.message) {
                if (obj.command === 'send') {
                    // e.g. send email or pushover or whatever
                    adapter.log.info('send command');
                    // Send response in callback if required
                    if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
                }
            }
        },
        // is called when databases are connected and adapter received configuration.
        // start here!
        ready: () => {
            adapter.getForeignObject('system.config', (err, obj) => {
                if (obj && obj.native && obj.native.secret) {
                    //noinspection JSUnresolvedVariable
                    adapter.config.Miele_pwd = decrypt(obj.native.secret, adapter.config.Miele_pwd);
                    adapter.config.Client_secret = decrypt(obj.native.secret, adapter.config.Client_secret);
                } else {
                    //noinspection JSUnresolvedVariable
                    adapter.config.Miele_pwd = decrypt(salt, adapter.config.Miele_pwd);
                    adapter.config.Client_secret = decrypt(salt, adapter.config.Client_secret);
                }
                // Execute main after pwds have been decrypted
                // The adapters config (in the instance object everything under the attribute "native") is accessible via
                // ADAPTER.config:
                if ( adapterConfigIsValid() ) {
                    main();
                } else {
                    adapter.log.warn('Adapter config is invalid. Please fix.');
                    adapter.setState('info.connection', false);
                    adapter.terminate('Invalid Configuration.', 11);
                }
            });
        }
    });
    // you have to call the adapter function and pass a options object
    // adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.mielecloudservice.0
    adapter = new utils.adapter(options);

    return adapter;
}

function addActionButton(path, action, description, buttonType){
   adapter.log.debug('addActionButton: Path['+ path +']');
   buttonType = buttonType || "button";
   createExtendObject(path + '.ACTIONS.' + action, {
            type: 'state',
            common: {"name": description,
                "read": false,
                "write": true,
                "role": 'button',
                "type": 'boolean'
            },
            native: {"type": buttonType // "button"
            }
        }
    );
    adapter.subscribeStates(path + '.ACTIONS.' + action);
}

function adapterConfigIsValid() {
    let configIsValid = true;

    if ('' === adapter.config.Miele_account) {
        adapter.log.warn('Miele account is missing.');
        configIsValid = false;
    }
    if ('' === adapter.config.Miele_pwd) {
        adapter.log.warn('Miele password is missing.');
        configIsValid = false;
    }
    if ('' === adapter.config.Client_ID) {
        adapter.log.warn('Miele API client ID is missing.');
        configIsValid = false;
    }
    if ('' === adapter.config.Client_secret) {
        adapter.log.warn('Miele API client secret is missing.');
        configIsValid = false;
    }
    if ('' === adapter.config.locale) {
        adapter.log.warn('Locale is missing.');
        configIsValid = false;
    }
    if ('' === adapter.config.oauth2_vg) {
        adapter.log.warn('OAuth2_vg is missing.');
        configIsValid = false;
    }
    if ('' === adapter.config.pollinterval) {
        adapter.log.warn('PollInterval is missing.');
        configIsValid = false;
    }

    return configIsValid;
}

function createExtendObject(id, objData, callback) {
    adapter.getObject(id, function (err, oldObj) {
        if (!err && oldObj) {
            adapter.extendObject(id, objData, callback);
        } else {
            adapter.setObjectNotExists(id, objData, callback);
        }
    });
}

function createEODeviceTypes(deviceTypeID){
/* List of possible devicetypes:
    2 = TUMBLE DRYER
    1 = WASHING MACHINE
    7 = DISHWASHER
    8 = DISHWASHER SEMI-PROF
    12 = OVEN
    13 = OVEN MICROWAVE
    14 = HOB HIGHLIGHT
    15 = STEAM OVEN
    16 = MICROWAVE
    17 = COFFEE SYSTEM
    18 = HOOD
    19 = FRIDGE
    20 = FREEZER
    21 = FRIDGE-/FREEZER COMBINATION
    23 = VACUUM CLEANER, AUTOMATIC ROBOTIC VACUUM CLEANER
    24 = WASHER DRYER
    25 = DISH WARMER
    27 = HOB INDUCTION
    28 = HOB GAS
    31 = STEAM OVEN COMBINATION
    32 = WINE CABINET
    33 = WINE CONDITIONING UNIT
    34 = WINE STORAGE CONDITIONING UNIT
    39 = DOUBLE OVEN
    40 = DOUBLE STEAM OVEN
    41 = DOUBLE STEAM OVEN COMBINATION
    42 = DOUBLE MICROWAVE
    43 = DOUBLE MICROWAVE OVEN
    45 = STEAM OVEN MICROWAVE COMBINATION
    48 = VACUUM DRAWER
    67 = DIALOGOVEN
    68 = WINE CABINET FREEZER COMBINATION
    */

    let deviceFolder;
    let description;

    switch (deviceTypeID) {
        case 1 :
            deviceFolder = 'Washing machines';
            description  = 'Washing machines reported by Miele@Home API';
            break;
        case 2:
            deviceFolder = 'Tumble dryers';
            description  = 'Tumble dryers reported by Miele@Home API';
            break;
        case 7:
        case 8:
            deviceFolder = 'Dishwashers';
            description  = 'Dishwashers reported by Miele@Home API';
            break;
        case 12:
        case 13:
        case 15:
        case 31:
        case 39:
        case 40:
        case 41:
        case 43:
        case 45:
        case 67:
            deviceFolder = 'Ovens';
            description  = 'Ovens reported by Miele@Home API';
            break;
        case 14:
        case 27:
        case 28:
            deviceFolder = 'Cooktops';
            description  = 'Cooktops reported by Miele@Home API';
            break;
        case 16:
        case 42:
            deviceFolder = 'Microwaves';
            description  = 'Microwaves reported by Miele@Home API';
            break;
        case 17:
            deviceFolder = 'Coffee Systems';
            description  = 'Coffee Systems reported by Miele@Home API';
            break;
        case 18:
            deviceFolder = 'Hoods';
            description  = 'Hoods reported by Miele@Home API';
            break;
        case 19:
        case 20:
        case 21:
        case 32:
        case 33:
        case 34:
        case 68:
            deviceFolder = 'Fridges';
            description  = 'Fridges reported by Miele@Home API';
            break;
        case 23:
            deviceFolder = 'Vacuum cleaners';
            description  = 'Vacuum cleaners reported by Miele@Home API';
            break;
        case 25:
            deviceFolder = 'Dish warmers';
            description  = 'Dish warmers reported by Miele@Home API';
            break;
        case 48:
            deviceFolder = 'Vacuum drawers';
            description  = 'Vacuum drawers reported by Miele@Home API';
            break;
    }

    createExtendObject(deviceFolder, {
        type: 'device',
        common: {
            name: description
        },
        native: {}
    });

    return deviceFolder;
}
/*
* @param: mieleDevice
* @param: mieleDevice.ident
* */
function splitMieleDevices(devices){
    // Splits the data-package returned by the API into single devices
    // and lets you iterate over each single device
    adapter.log.debug('[splitMieleDevices] Splitting JSON to single devices.');
    for (let mieleDevice in devices) {
        adapter.log.debug('splitMieleDevices: ' + mieleDevice+ ': [' + mieleDevice + '] *** Value: [' + JSON.stringify(devices[mieleDevice]) + ']');
        parseMieleDevice(devices[mieleDevice]);
    }
}

/*
* @param mieleDevice
* @param mieleDevice.ident
* @param mieleDevice.ident.type
* @param mieleDevice.ident.type.value_localized
* @param mieleDevice.ident.type.value_raw
* @param mieleDevice.ident.deviceIdentLabel.fabNumber
* */
function parseMieleDevice(mieleDevice){
    let deviceFolder;
    adapter.log.debug('This is a ' + mieleDevice.ident.type.value_localized );
    deviceFolder = createEODeviceTypes(mieleDevice.ident.type.value_raw); // create folder for device
    addMieleDevice(deviceFolder, mieleDevice);

    // add special datapoints to devices
    // Action required due to wet clothes, dry clothes, clean dishes, ...
    // set to true when device has finished and door hasn't opend yet
    // set to false when device has finished and door is open
    // set to false when device has been started and door is closed
    switch (mieleDevice.ident.type.value_raw) {
        case  1: // Washing machine
        case  2: // Tumble dryer
        case  7: // Dishwasher
        case 12: // Washer dryer
            // set to true when device has finished (Value_raw 7 => end programmed) and door hasn't opend yet
            if (mieleDevice.state.status.value_raw === 7 && !mieleDevice.signalDoor) {
                createBool(deviceFolder + '.' + mieleDevice.ident.deviceIdentLabel.fabNumber + '.signalActionRequired', 'Action required on device due to wet clothes, dry clothes, clean dishes, ...', true);
            }
            // set to false when device has finished and door is open
            if ( ((mieleDevice.state.status.value_raw === 7) || mieleDevice.state.status.value_raw === 1) && mieleDevice.signalDoor) {
                createBool(deviceFolder + '.' + mieleDevice.ident.deviceIdentLabel.fabNumber + '.signalActionRequired', 'Action required on device due to wet clothes, dry clothes, clean dishes, ...', false);
            }
            // set to false when device has been started and door is closed
            if (mieleDevice.state.status.value_raw === 5 && !mieleDevice.signalDoor) {
                createBool(deviceFolder + '.' + mieleDevice.ident.deviceIdentLabel.fabNumber + '.signalActionRequired', 'Action required on device due to wet clothes, dry clothes, clean dishes, ...', false);
            }
    }

            // spinning speed
    switch (mieleDevice.ident.type.value_raw) {
        case  1: // Washing machine
            createNumber(deviceFolder + '.' + mieleDevice.ident.deviceIdentLabel.fabNumber + '.' + mieleDevice.state.spinningSpeed.key_localized,
                    'Spinning speed of a washing machine.',
                              mieleDevice.state.spinningSpeed.value_localized,
                              mieleDevice.state.spinningSpeed.unit,
                         'value.spinningspeed');
            break;
    }
    // elapsedTime
    switch (mieleDevice.ident.type.value_raw) {
        case  1: // Washing machine
        case  2: // Tumble dryer
        case  7: // Dishwasher
        case 10: // Oven
        case 13: // Oven microwave
        case 15: // Steam oven
        case 12: // Washer dryer
        case 31: // Steam oven combination
        case 43: // Steam oven microwave combination
        case 67: // DialogOven
            createTime(deviceFolder + '.' + mieleDevice.ident.deviceIdentLabel.fabNumber + '.elapsedTime', 'ElapsedTime since program start (only present for certain devices)', mieleDevice.state.elapsedTime);
            break;
        case 18: // Hood
            createStringAndRaw(deviceFolder + '.' + mieleDevice.ident.deviceIdentLabel.fabNumber, 'This field is only valid for hoods.', mieleDevice.state.ventilationStep.key_localized, mieleDevice.state.ventilationStep.value_localized, mieleDevice.state.ventilationStep.value_raw, '');
            break;
    }
    // dryingStep
    switch (mieleDevice.ident.type.value_raw) {
        case  2: // tumble dryer
        case 24: // washer dryer
            createStringAndRaw(deviceFolder + '.' + mieleDevice.ident.deviceIdentLabel.fabNumber, 'This field is only valid for tumble dryers and washer-dryer combinations.', mieleDevice.state.dryingStep.key_localized, mieleDevice.state.dryingStep.value_localized, mieleDevice.state.dryingStep.value_raw, '');
            break;
    }
    // PlateStep - occurs at Hobs
    switch (mieleDevice.ident.type.value_raw) {
        case 14: // Highlight Hob
        case 27: // Induction Hob
            createArray(deviceFolder + '.' + mieleDevice.ident.deviceIdentLabel.fabNumber + mieleDevice.state.plateStep[0].key_localized,
                   'The plateStepobject represents the selected cooking zone levels for a hob.',
                             mieleDevice.state.plateStep);
            break;
    }

}

function addMieleDevice(path, mieleDevice){
    let newPath = path + '.' + mieleDevice.ident.deviceIdentLabel.fabNumber;
    adapter.log.debug('addMieleDevice: NewPath = [' + newPath + ']');

    createExtendObject(newPath, {
        type: 'device',
        common: {name:   (mieleDevice.ident.deviceName === ''? mieleDevice.ident.type.value_localized: mieleDevice.ident.deviceName) , read: true, write: false},
        native: {}
    });

    // add device specific actions
    addMieleDeviceActions(newPath, mieleDevice.ident.type.value_raw);
    addDeviceNicknameAction(newPath, mieleDevice);

    // add device states and idents
    for (let deviceInfo in mieleDevice){
        adapter.log.debug('addMieleDevice:' + deviceInfo);
        switch (deviceInfo) {
            case 'ident':
                addMieleDeviceIdent(newPath, mieleDevice[deviceInfo]);
                break;
            case 'state':
                addMieleDeviceState(newPath, mieleDevice[deviceInfo]);
                break;
        }
    }
}

function createBool(path, description, value, role){
    role = role || 'indicator';
    adapter.log.debug('createBool: Path['+ path +'] Value[' + value + ']');
    createExtendObject(path, {
        type: 'state',
        common: {"name": description,
            "read": true,
            "write":false,
            "role": role,
            "type": "boolean"
        }
    });
    adapter.setState(path, value, true);
}

function createString(path, description, value){
    adapter.log.debug('createString: Path['+ path +'] Value[' + value + ']');
    createExtendObject(path, {
        type: 'state',
        common: {"name": description,
            "read":  true,
            "write": false,
            "role": "state",
            "type": "string"
        }
    });
    adapter.setState(path, value, true);
}

function createStringAndRaw(path, description, key_localized, value_localized, value_raw, unit){
    adapter.log.debug('createStringAndRaw: Path:[' + path + '] key_localized:[' + key_localized + '] value_localized[' + value_localized + '] value_raw[' + value_raw +'] unit[' + unit   +']' );
    createExtendObject(path + '.' + key_localized +'_raw', {
        type: 'state',
        common: {"name":  description + ' (value raw)',
            "read":  true,
            "write": false,
            "role": "value.raw",
            "type": "number"
        }
    });
    adapter.setState(path + '.' + key_localized +'_raw', value_raw, true);

    createExtendObject(path + '.' + key_localized, {
        type: 'state',
        common: {"name":  description,
            "read":  true,
            "write": false,
            "role": "value",
            "type": "string"
        }
    });
    adapter.setState(path + '.' + key_localized, value_localized + ' ' + unit, true);
}

function createTime(path, description, value, role){
    role = role || 'value.time';
    createExtendObject(path, {
        type: 'state',
        common: {"name": description,
            "read": true,
            "write":false,
            "role": "value",
            "type": "string"
        }
    });
    adapter.log.debug('createTime: Path:['+ path +'], value:['+ value +']');
    let assembledValue = value[0] + ':' + (value[1]<10? '0': '') + value[1];
    adapter.setState(path, assembledValue, true);
}

function createNumber(path, description, value, unit, role){
    adapter.log.debug('[createNumber]: Path['+ path +'] Value[' + value + '] Unit[' + unit + ']');
    // get back to calling function if there is no valid value given.
    if ( !value || value === -32768 ) {
        adapter.log.debug('[createNumber]: invalid value detected. Skipping...');
        return;
    }
    role = role || 'value';

    switch (unit){
        case "Celsius" : unit = "°C";
            break;
        case "Fahrenheit" : unit = "°F";
            break;
    }
    adapter.log.debug('createNumber: Path['+ path +'] Value[' + value + '] Unit[' + unit + ']');
    createExtendObject(path, {
        type: 'state',
        common: {"name": description,
            "read": true,
            "write":false,
            "role": role,
            "type": "number",
            "unit": unit
        }
    });
    adapter.setState(path, value, true);
}


/*
* @param value
* @param value[].value_localized
 */
function createArray(path, description, value){
    // depending on the device we receive up to 3 values
    // there is a min of 1 and a max of 3 temps returned by the miele API
    let MyPath = path;
    const items = Object.keys(value).length;
    adapter.log.debug('Number of Items in Array: [' + items +']');
    for (let n in value) {
        if (items > 1){
            MyPath = path + '_' + n;
        }
        adapter.log.debug('createArray: Path:['   + MyPath  + ']');
        adapter.log.debug('createArray:  value:[' + value   + ']');
        adapter.log.debug('createArray:  OrgUnit: [' + value[n].unit + ']');
        createNumber(MyPath, description, value[n].value_localized, value[n].unit, 'value.temperature')
    }
}

function addMieleDeviceIdent(path, currentDeviceIdent){
    adapter.log.debug('addMieleDeviceIdent: Path = [' + path + ']');
    createString(path + '.ComModFirmware', "the release version of the communication module", currentDeviceIdent.xkmIdentLabel.releaseVersion);
    createString(path + '.ComModTechType', "the technical type of the communication module", currentDeviceIdent.xkmIdentLabel.techType);
    createString(path + '.DeviceSerial', "the serial number of the device", currentDeviceIdent.deviceIdentLabel.fabNumber);
    createString(path + '.DeviceTechType', "the technical type of the device", currentDeviceIdent.deviceIdentLabel.techType);
    createString(path + '.DeviceMatNumber', "the material number of the device", currentDeviceIdent.deviceIdentLabel.matNumber);
}

/*
* @param  currentDeviceState.status.key_localized
* @param  status
* @param  ProgramID
* @param  remainingTime
* @param  programPhase
* @param  key_localized
* @param  value_raw
* @param  value_localized
 */
function addMieleDeviceState(path, currentDeviceState){
    adapter.log.debug('addMieleDeviceState: Path: [' + path + ']');
    // set the values for redundant state indicators
    createBool(path + '.Connected', 'Indicates whether the device is connected to WLAN or Gateway.', currentDeviceState.status.value_raw !== 255, 'indicator.reachable');
    createBool(path + '.signalInUse', 'Indicates whether the device is in use or switched off.', currentDeviceState.status.value_raw !== 1, 'indicator.InUse');
    // regular states
    createStringAndRaw(path, 'main Device state', currentDeviceState.status.key_localized, currentDeviceState.status.value_localized, currentDeviceState.status.value_raw, '');
    createStringAndRaw(path, 'ID of the running Program', currentDeviceState.ProgramID.key_localized, currentDeviceState.ProgramID.value_localized, currentDeviceState.ProgramID.value_raw, '');
    createStringAndRaw(path, 'programType of the running Program', currentDeviceState.programType.key_localized,  currentDeviceState.programType.value_localized, currentDeviceState.programType.value_raw, '');
    createStringAndRaw(path, 'phase of the running Program', currentDeviceState.programPhase.key_localized,  currentDeviceState.programPhase.value_localized, currentDeviceState.programPhase.value_raw, '');
    createTime(path + '.remainingTime', 'The RemainingTime equals the relative remaining time', currentDeviceState.remainingTime);
    createTime(path + '.startTime', 'The StartTime equals the relative starting time', currentDeviceState.startTime);
    createArray(path + '.targetTemperature', 'The TargetTemperature field contains information about one or multiple target temperatures of the process.', currentDeviceState.targetTemperature);
    createArray(path + '.Temperature', 'The Temperature field contains information about one or multiple temperatures of the device.', currentDeviceState.temperature);
    createBool(path + '' +'.signalInfo', 'The SignalInfo field indicates, if a notification is active for this Device.', currentDeviceState.signalInfo);
    createBool(path + '.signalFailure', 'The SignalFailure field indicates, if a failure is active for this Device.', currentDeviceState.signalFailure);
    createBool(path + '.signalDoor', 'The SignalDoor field indicates, if a door-open message is active for this Device.', currentDeviceState.signalDoor);
    createBool(path + '.Light', 'The light field indicates the status of the device light.', currentDeviceState.light === 1?'Enabled':(currentDeviceState.light === 2?'Disabled':'Invalid') );
    createBool(path + '.fullRemoteControl', 'The device can be controlled from remote.', currentDeviceState.remoteEnable.fullRemoteControl);
    createBool(path + '.smartGrid', 'The device is set to Smart Grid mode.', currentDeviceState.remoteEnable.smartGrid);
}

function addDeviceNicknameAction(path, mieledevice) {
    adapter.log.debug( 'addDeviceNicknameAction: Path:['+ path +'], mieledevice:['+JSON.stringify(mieledevice)+']' );
    // addDeviceNicknameAction - suitable for each and every device
    createExtendObject(path + '.ACTIONS.Nickname', {
        type: 'state',
        common: {
            name: 'Nickname of your device. Can be edited in Miele APP or here!',
            read: true,
            write: true,
            type: 'string'
        },
        native: {}
    });
    adapter.setState(path + '.ACTIONS.Nickname', (mieledevice.ident.deviceName === '' ? mieledevice.ident.type.value_localized : mieledevice.ident.deviceName), true);
    adapter.subscribeStates(path + '.ACTIONS.Nickname');
}

function addPowerActionButtons(path) {
    // addPowerOnAction
    addActionButton(path,'Power On', 'Power the Device on.');
    // addPowerOffAction
    addActionButton(path,'Power Off', 'Power the Device off.');
}

function addStartActionButton(path) {
    // addStartAction
    addActionButton(path,'Start', 'Starts the Device.', 'button.start');
}

function addStopActionButton(path) {
    // addStopAction
    addActionButton(path,'Stop', 'Stops the Device.', 'button.stop');
}

function addStartStopActionButtons(path) {
    addStartActionButton(path);
    addStopActionButton(path);
}

function addLightActionButtons(path) {
    // addLightOnAction
    addActionButton(path,'Light On', 'Switches the lights of the Device on.');
    // addLightOffAction
    addActionButton(path,'Light Off', 'Switches the lights of the Device off.');
}

function addSupercoolingActionButtons(path) {
    // addLightOnAction
    addActionButton(path,'Start Supercooling', 'Brings the Device into Supercooling mode.');
    // addLightOffAction
    addActionButton(path,'Stop Supercooling', 'Brings the Device out of Supercooling mode.');
}

function addSuperfreezingActionButtons(path) {
    // addLightOnAction
    addActionButton(path,'Start Superfreezing', 'Brings the Device into Superfreezing mode.');
    // addLightOffAction
    addActionButton(path,'Stop Superfreezing', 'Brings the Device out of Superfreezing mode.');
}

function addMieleDeviceActions(path, DeviceType){
    adapter.log.debug(`addMieleDeviceActions: Path: [${path}]`);
    // Create ACTIONS folder if not already existing
    createExtendObject(path + '.ACTIONS', {
        type: 'channel',
        common: {name: 'Supported Actions for this device.', read: true, write: true},
        native: {}
    });

    // Add Actions depending on devicetype
    switch (DeviceType) {
        case 1:
        case 2:
        case 7:
            addPowerActionButtons(path);
            addStartStopActionButtons(path);
            // addStartTimeAction
            break;
        case 12:
        case 13:
            // addStopAction
            addStopActionButton(path);
            break;
        case 17:
        case 18:
            // addStopAction
            addStopActionButton(path);
            // addLightEnable
            // addLightDisable
            addLightActionButtons(path);
            break;
        case 19:
            // addStartSuperCoolingAction
            // addStopSuperCoolingAction
            addSupercoolingActionButtons(path);
            break;
        case 20:
            // addStartSuperFreezingAction
            // addStopSuperFreezingAction
            addSuperfreezingActionButtons(path);
            break;
        case 21:
            // addStartSuperCoolingAction
            // addStopSuperCoolingAction
            addSupercoolingActionButtons(path);
            // addStartSuperFreezingAction
            // addStopSuperFreezingAction
            addSuperfreezingActionButtons(path);
            break;
        case 24:
            // addStopAction
            addStopActionButton(path);
            break;
        case 31:
            // addStopAction
            addStopActionButton(path);
            break;
        case 32:
            // addLightEnable
            // addLightDisable
            addLightActionButtons(path);
            break;
        case 33:
            // addLightEnable
            // addLightDisable
            addLightActionButtons(path);
            break;
        case 34:
            // addLightEnable
            // addLightDisable
            addLightActionButtons(path);
            break;
        case 45:
            // addStopAction
            addStopActionButton(path);
            break;
        case 67:
            // addStopAction
            addStopActionButton(path);
            break;
        case 68:
            // addLightEnable
            // addLightDisable
            addLightActionButtons(path);
            // addStartSuperFreezingAction
            // addStopSuperFreezingAction
            addSuperfreezingActionButtons(path);
            break;
    }
}

/*
 * decrypt
 *
 * @param key   {string} secret key used for decryption
 * @param value {string} string that needs to be decrypted
 * @returns     {string} decrypted version of dtring given in param value
 */
function decrypt(key, value) {
    let result = '';
    for (let i = 0; i < value.length; ++i) {
        result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
}
/*
 * refreshMieledata
 *
 * @param Auth {object}  OAuth2 object containing required credentials
 * @returns    {void}    returns nothing
 */
async function refreshMieledata(auth){
    adapter.log.debug('refreshMieledata: get data from API');
    try {
        let result = await APISendRequest(auth, 'v1/devices/?language=' + adapter.config.locale, 'GET', '');
        adapter.log.debug('refreshMieledata: handover all devices data to splitMieledevices');
        adapter.log.debug('refreshMieledata: data [' + JSON.stringify(result) + ']');
        splitMieleDevices(result);
    } catch(error) {
        adapter.log.error('[refreshMieledata] [' + error +'] |-> JSON.stringify(error):' + JSON.stringify(error));
    }
}

/*
 *  Main function
 */
async function main() {
    try {
        auth = await APIGetAccessToken();
        if (auth.hasOwnProperty('access_token') ) {
            adapter.log.info('Starting Polltimer with a ' +  adapter.config.pollinterval + ' Minutes interval.');
            // start refresh scheduler with interval from adapters config
            pollTimeout= setTimeout(function schedule() {
                adapter.log.debug("Updating device states (polling API scheduled).");
                refreshMieledata( auth );
                pollTimeout= setTimeout(schedule , adapter.config.pollinterval * 60000);
            } , 100);
        } else {
            adapter.log.error('[main] APIGetAccessToken returned neiter a token nor an errormessage. Returned value=[' + JSON.stringify(auth)+']');
        }
    } catch(err) {
        adapter.log.error('[main] ' + JSON.stringify(err));
    }
}//End Function main


// API-Functions
async function APIGetAccessToken() {
    adapter.log.debug('function APIGetAccessToken');
    const getOwnerCredentials = oauth.client(axios.create(), {
        url: BaseURL + 'thirdparty/token/',
        grant_type: 'password',
        client_id: adapter.config.Client_ID,
        client_secret: adapter.config.Client_secret,
        username: adapter.config.Miele_account,
        password: adapter.config.Miele_pwd,
        vg: adapter.config.oauth2_vg
    });

    adapter.log.debug('Awaiting OAuth2 Token.');
    adapter.log.debug('OAuth2 grant_type: [password]');
    adapter.log.debug('options OAuth2-VG: [' + adapter.config.oauth2_vg + ']');
    adapter.log.debug('config API Language: [' + adapter.config.locale + ']');
    /*
    // Logging of credentials has been commented out intentionally. May be enabled again by user for debugging purposes
    adapter.log.debug('options Miele_account: [' + adapter.config.Miele_account + ']');
    adapter.log.debug('options Client_ID: ['     + adapter.config.Client_ID     + ']');
    adapter.log.debug('options Miele_Password: ['+ adapter.config.Miele_pwd     + ']');
    adapter.log.debug('options Client_Secret: [' + adapter.config.Client_secret + ']');
     */
    try {
        const auth = await getOwnerCredentials();
        expiryDate = new Date();
        expiryDate.setSeconds(expiryDate.getSeconds() + auth.hasOwnProperty('expires_in') ? auth.expires_in : 0);
        adapter.log.info('Access-Token expires at:  [' + expiryDate.toString() + ']');
        adapter.setState('info.connection', true);
        return auth;
    } catch (error) {
        adapter.log.error('OAuth2 returned an error!');
        adapter.log.error(error);
        adapter.log.error('Are your credentials okay? Please doublecheck them in your adapters configuration.');
        adapter.setState('info.connection', false);
        adapter.terminate('Terminating adapter due to error on token request.', 11);
    }
}


async function APIRefreshToken(refresh_token) {
    adapter.log.debug('function APIGetAccessToken');
    const getNewAccessToken = oauth.client(axios.create(), {
        url: BaseURL + 'thirdparty/token/',
        grant_type: 'refresh_token',
        client_id: adapter.config.Client_ID,
        client_secret: adapter.config.Client_secret,
        refresh_token: refresh_token,
        vg: adapter.config.oauth2_vg
    });

    adapter.log.debug('Awaiting new OAuth2 Token.');
    adapter.log.debug('OAuth2 grant_type: [refresh_token]');
    adapter.log.debug('options OAuth2-VG: [' + adapter.config.oauth2_vg + ']');
    adapter.log.debug('config API Language: [' + adapter.config.locale + ']');
    try {
        const auth = await getNewAccessToken();
        expiryDate = new Date();
        expiryDate.setSeconds(expiryDate.getSeconds() +  auth.hasOwnProperty('expires_in')?auth.expires_in:0 );
        adapter.log.info('New Access-Token expires at:  [' + expiryDate.toString() + ']');
        adapter.setState('info.connection', true);
        return auth;
    }  catch (error){
        adapter.log.error('OAuth2 returned an error!');
        adapter.log.error(error);
        adapter.setState('info.connection', false);
        // TODO Think about an error-counter and terminating the adapter on too many errors
        // adapter.terminate('Terminating adapter due to error on token request.', 11);
    }
}

async function APILogOff(auth, token_type) {
    adapter.log.debug('[APILogOff]: Invalidating: '+token_type + ' ('+auth[token_type]+')');
    await APISendRequest(auth, "thirdparty/logout/", "POST", "token: "+ auth[token_type] )
         .catch(error => {adapter.log.error('[APILogOff] ' + JSON.stringify(error) + ' Stack: '+error.stack)});
}

async function APIStartAction(auth, path, action, value) {
    let currentAction;
    let paths = path.split('.');    // transform into array
    paths.pop();                    // remove last element of path
    let device = paths[3];          // device is the fourth element of the path array
    let currentPath = paths.join('.');         // join all elements back together
    adapter.log.debug("APIStartAction: received Action: ["+action+"] with value: ["+value+"] for device ["+device+"] / path:["+currentPath+"]");
    switch (action) {
        case 'Nickname': currentAction = {'deviceName':value};
            break;
        case 'Power On': currentAction = {'powerOn':true};
            break;
        case 'Power Off': currentAction = {'powerOff':true};
            break;
        case 'Start': currentAction = {'processAction':START};
            break;
        case 'Stop': currentAction = {'processAction':STOP};
            break;
        case 'Pause': currentAction = {'processAction':PAUSE};
            break;
        case 'Start Superfreezing': currentAction = {processAction:START_SUPERFREEZING};
            break;
        case 'Stop Superfreezing': currentAction = {processAction:STOP_SUPERFREEZING};
            break;
        case 'Start Supercooling': currentAction = {processAction:START_SUPERCOOLING};
            break;
        case 'Stop Supercooling': currentAction = {processAction:STOP_SUPERCOOLING};
            break;
        case 'Light On': currentAction = {light:LIGHT_ON};
            break;
        case 'Light Off': currentAction = {light:LIGHT_OFF};
            break;
    }
    adapter.log.debug("APIStartAction: Executing Action: [" +JSON.stringify(currentAction) +"]");
    try {
        APISendRequest(auth, 'v1/devices/' + device + '/actions', 'PUT', currentAction);
        createString(currentPath + '.Action information', 'Additional Information returned from API.', action + ': ' + result.message);
        if (result.status >= 200 && result.status < 300) {
            adapter.log.debug(`Result returned from Action(${action})-execution: [${JSON.stringify(result.message)}]`);
            createBool(currentPath + '.Action successful', 'Indicator if last executed Action has been successful.', true);
            refreshMieledata(auth);
        } else if (result.status >= 300){
            createBool(currentPath + '.Action successful', 'Indicator if last executed Action has been successful.', false);
        }
    } catch(err) {
        adapter.log.error('[APISendRequest] ' + JSON.stringify(err));
    }
}

async function APISendRequest(auth, Endpoint, Method, actions) {
    // build options object for axios
    const options = {
        url: BaseURL + Endpoint,
        method: Method,
        json: true,
        dataType: "json",
        headers: {
            Authorization: 'Bearer ' + auth.access_token,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        data: actions
    };

        adapter.log.debug('APISendRequest: Awaiting requested data.');
        try {
            let response = await axios(options);
            adapter.log.debug('API returned Status: [' + response.status + ']');
            switch (response.status) {
                case 202:
                    response.data =  {"message": "Accepted, processing has not been completed."};
                    break;
                case 204: // OK, No Content
                    response.data =  {"message": "OK"};
                    break;
            }
            adapter.log.debug('API returned Data: [' + JSON.stringify(response.data) + ']');
            return response.data;
        } catch(error) {
            adapter.log.debug('Given parameters:');
            adapter.log.debug('Auth: [' + JSON.stringify(auth) + ']');
            adapter.log.debug('Endpoint: [' + Endpoint + ']');
            adapter.log.debug('Method: [' + Method + ']');
            adapter.log.debug('Actions: [' + actions + ']');
            adapter.log.error('[APISendRequest] ' + JSON.stringify(error) + ' | [Stack]: ' + error.stack);
            if (error.response) {
                // Request made and server responded
                adapter.log.error('Request made and server responded:');
                adapter.log.error(error.response.data);
                adapter.log.error(error.response.status);
                adapter.log.error(error.response.headers);
            } else if (error.request) {
                // The request was made but no response was received
                adapter.log.error('The request was made but no response was received:');
                adapter.log.error(error.request);
            } else {
                // Something happened in setting up the request that triggered an Error
                adapter.log.error('Something happened in setting up the request that triggered an Error:');
                adapter.log.error('Error', error.message);
            }
            switch (error.response.status) {
                case 401:
                    try {
                        adapter.log.info('OAuth2 Access token has expired. Trying to refresh it.');
                        auth = APIRefreshToken(auth.refresh_token);
                    } catch (err) {
                        adapter.log.error('[APIRefreshToken] ' + JSON.stringify(err));
                    }
                    break;
                case 504:
                    adapter.log.error('HTTP 504: Gateway Timeout! This error occured outside of this adapter. Please google it for possible reasons and solutions.');
                    break;
            }
        }
}

// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startadapter;
} else {
    // or start the instance directly
    startadapter();
}