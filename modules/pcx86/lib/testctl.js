/**
 * @fileoverview TestController Class for SerialPort-based Testing
 * @author <a href="mailto:Jeff@pcjs.org">Jeff Parsons</a>
 * @copyright © 2012-2019 Jeff Parsons
 *
 * This file is part of PCjs, a computer emulation software project at <https://www.pcjs.org>.
 *
 * PCjs is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3
 * of the License, or (at your option) any later version.
 *
 * PCjs is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
 * even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with PCjs.  If not,
 * see <http://www.gnu.org/licenses/gpl.html>.
 *
 * You are required to include the above copyright notice in every modified copy of this work
 * and to display that copyright notice when the software starts running; see COPYRIGHT in
 * <https://www.pcjs.org/modules/shared/lib/defines.js>.
 *
 * Some PCjs files also attempt to load external resource files, such as character-image files,
 * ROM files, and disk image files. Those external resource files are not considered part of PCjs
 * for purposes of the GNU General Public License, and the author does not claim any copyright
 * as to their contents.
 */

"use strict";

/*
 * This module provides connectivity between the TestMonitor component and whichever PCx86 SerialPort
 * our 'binding' property indicates, if any.
 */

if (typeof module !== "undefined") {
    var Str         = require("../../shared/lib/strlib");
    var Web         = require("../../shared/lib/weblib");
    var Component   = require("../../shared/lib/component");
    var PCX86       = require("./defines");
    var TestMonitor = require("./testmon");
}

/**
 * TestController class
 *
 * @class TestController
 * @property {string|undefined} urlTests
 * @property {Object|null} tests
 * @property {string|null} consoleBuffer
 * @property {HTMLTextAreaElement|null} controlBuffer
 * @property {function(...)|null} sendData
 * @property {function(number)|null} deliverData
 * @property {function(number)|null} deliverInput
 * @property {function(Object)|null} deliverTests
 * @unrestricted (allows the class to define properties, both dot and named, outside of the constructor)
 */
class TestController extends Component {
    /**
     * TestController(parms)
     *
     * @this {TestController}
     * @param {Object} parms
     */
    constructor(parms)
    {
        super("TestController", parms);

        this.tests = null;
        let fLoading = false;
        this.urlTests = parms['tests'];

        this.consoleBuffer = "";
        this.controlBuffer = null;
        this.sendData = null;
        this.deliverData = this.deliverInput = this.deliverTests = null;

        this.sBinding = parms['binding'];
        if (this.sBinding) {
            this.serialPort = Component.getComponentByID(this.sBinding, this.id);
            if (this.serialPort) {
                let exports = this.serialPort['exports'];
                if (exports) {
                    let bind = /** @function */ (exports['bind']);
                    if (bind && bind.call(this.serialPort, this, this.receiveData, true)) {
                        this.sendData = exports['receiveData'].bind(this.serialPort);
                        if (this.urlTests) {
                            this.loadTests(this.urlTests);
                            fLoading = true;
                        }
                    }
                }
            }
            if (!this.sendData) {
                Component.warning(this.id + ": binding '" + this.sBinding + "' unavailable");
            }
        }
        if (!fLoading) this.setReady();
    }

    /**
     * loadTests(sURL)
     *
     * @this {TestController}
     * @param {string} sURL
     */
    loadTests(sURL)
    {
        let controller = this;
        let sProgress = "Loading " + sURL + "...";
        Web.getResource(sURL, null, true, function(sURL, sResponse, nErrorCode) {
            controller.doneLoad(sURL, sResponse, nErrorCode);
        }, function(nState) {
            controller.println(sProgress, Component.PRINT.PROGRESS);
        });

    }

    /**
     * doneLoad(sURL, sTestData, nErrorCode)
     *
     * @this {TestController}
     * @param {string} sURL
     * @param {string} sTestData
     * @param {number} nErrorCode (response from server if anything other than 200)
     */
    doneLoad(sURL, sTestData, nErrorCode)
    {
        if (nErrorCode) {
            this.notice("Unable to load tests (error " + nErrorCode + ": " + sURL + ")", nErrorCode < 0);
        }
        else {
            try {
                this.tests = /** @type {Object} */ (JSON.parse(sTestData));
                if (this.deliverTests) {
                    this.deliverTests(this.tests);
                    this.tests = null;
                }
                Component.addMachineResource(this.idMachine, sURL, sTestData);
            } catch (err) {
                this.notice("Test parsing error: " + err.message);
            }
        }
        this.setReady();
    }

    /**
     * bindMonitor(monitor, deliverData, deliverInput, deliverTests)
     *
     * @this {TestController}
     * @param {TestMonitor} monitor
     * @param {function(number)} deliverData
     * @param {function(number)} deliverInput
     * @param {function(Object)} deliverTests
     */
    bindMonitor(monitor, deliverData, deliverInput, deliverTests)
    {
        this.deliverData = deliverData.bind(monitor);
        this.deliverInput = deliverInput.bind(monitor);
        this.deliverTests = deliverTests.bind(monitor);
        if (this.tests && this.deliverTests) {
            this.deliverTests(this.tests);
            this.tests = null;
        }
    }

    /**
     * setBinding(sHTMLType, sBinding, control, sValue)
     *
     * @this {TestController}
     * @param {string} sHTMLType is the type of the HTML control (eg, "button", "list", "text", "submit", "textarea", "canvas")
     * @param {string} sBinding is the value of the 'binding' parameter stored in the HTML control's "data-value" attribute (eg, "buffer")
     * @param {HTMLElement} control is the HTML control DOM object (eg, HTMLButtonElement)
     * @param {string} [sValue] optional data value
     * @return {boolean} true if binding was successful, false if unrecognized binding request
     */
    setBinding(sHTMLType, sBinding, control, sValue)
    {
        let controller = this;

        if (sHTMLType == "textarea" && !this.controlBuffer) {

            this.bindings[sBinding] = control;
            this.controlBuffer = /** @type {HTMLTextAreaElement} */ (control);
            this.consoleBuffer = null;          // we currently use one or the other: control or console

            /*
             * By establishing an onkeypress handler here, we make it possible for DOS commands like
             * "CTTY COM1" to more or less work (use "CTTY CON" to restore control to the DOS console).
             */
            control.onkeydown = function onKeyDown(event) {
                /*
                 * This is required in addition to onkeypress, because it's the only way to prevent
                 * BACKSPACE (keyCode 8) from being interpreted by the browser as a "Back" operation;
                 * moreover, not all browsers generate an onkeypress notification for BACKSPACE.
                 *
                 * A related problem exists for Ctrl-key combinations in most Windows-based browsers
                 * (eg, IE, Edge, Chrome for Windows, etc), because keys like Ctrl-C and Ctrl-S have
                 * special meanings (eg, Copy, Save).  To the extent the browser will allow it, we
                 * attempt to disable that default behavior when this control receives an onkeydown
                 * event for one of those keys (probably the only event the browser generates for them).
                 */
                event = event || window.event;
                let keyCode = event.keyCode;
                if (keyCode === 0x08 || event.ctrlKey && keyCode >= 0x41 && keyCode <= 0x5A) {
                    if (event.preventDefault) event.preventDefault();
                    if (keyCode > 0x40) keyCode -= 0x40;
                    if (controller.deliverInput) controller.deliverInput(keyCode);
                }
                return true;
            };

            control.onkeypress = function onKeyPress(event) {
                /*
                 * Browser-independent keyCode extraction; refer to onKeyPress() and the other key event
                 * handlers in keyboard.js.
                 */
                event = event || window.event;
                let keyCode = event.which || event.keyCode;
                if (controller.deliverInput) controller.deliverInput(keyCode);
                /*
                 * Since we're going to remove the "readonly" attribute from the <textarea> control
                 * (so that the soft keyboard activates on iOS), instead of calling preventDefault() for
                 * selected keys (eg, the SPACE key, whose default behavior is to scroll the page), we must
                 * now call it for *all* keys, so that the keyCode isn't added to the control immediately,
                 * on top of whatever the machine is echoing back, resulting in double characters.
                 */
                if (event.preventDefault) event.preventDefault();
                return true;
            };

            /*
             * Now that we've added an onkeypress handler that calls preventDefault() for ALL keys, the control
             * itself no longer needs the "readonly" attribute; we primarily need to remove it for iOS browsers,
             * so that the soft keyboard will activate, but it shouldn't hurt to remove the attribute for all browsers.
             */
            control.removeAttribute("readonly");

            if (this.sendData) {
                let monitor = new TestMonitor();
                monitor.bindController(this, this.sendData, this.sendOutput, this.printf, this.sBinding);
            }
            return true;
        }
        return false;
    }

    /**
     * sendOutput(data)
     *
     * @this {TestController}
     * @param {number|string|Array} data
     */
    sendOutput(data)
    {
        if (typeof data == "number") {
            this.printf("%c", data);
        }
        else if (typeof data == "string") {
            this.printf("%s", data);
        }
        else {
            for (let i = 0; i < data.length; i++) this.printf("[0x%02x]", data[i]);
        }
    }

    /**
     * printf(format, ...args)
     *
     * @this {TestController}
     * @param {string} format
     * @param {...} args
     */
    printf(format, ...args)
    {
        let s = Str.sprintf(format, ...args);

        if (this.controlBuffer != null) {
            if (s != '\r') {
                if (s == '\b' || s == "\b \b") {
                    this.controlBuffer.value = this.controlBuffer.value.slice(0, -1);
                } else {
                    this.controlBuffer.value += s;
                }
                /*
                 * Prevent the <textarea> from getting too large; otherwise, printing becomes slower and slower.
                 */
                if (!DEBUG && this.controlBuffer.value.length > 8192) {
                    this.controlBuffer.value = this.controlBuffer.value.substr(this.controlBuffer.value.length - 4096);
                }
                this.controlBuffer.scrollTop = this.controlBuffer.scrollHeight;
            }
        }

        if (this.consoleBuffer != null) {
            let i = s.lastIndexOf('\n');
            if (i >= 0) {
                console.log(this.consoleBuffer + s.substr(0, i));
                this.consoleBuffer = "";
                s = s.substr(i + 1);
            }
            this.consoleBuffer += s;
        }
    }

    /**
     * receiveData(data)
     *
     * @this {TestController}
     * @param {number|string|Array} data
     */
    receiveData(data)
    {
        if (typeof data == "number") {
            this.deliverData(data);
        }
        else if (typeof data == "string") {
            for (let i = 0; i < data.length; i++) this.deliverData(data.charCodeAt(i));
        }
        else {
            for (let i = 0; i < data.length; i++) this.deliverData(data[i]);
        }
    }

    /**
     * TestController.init()
     *
     * This function operates on every HTML element of class "TestController", extracting the
     * JSON-encoded parameters for the TestController constructor from the element's "data-value"
     * attribute, invoking the constructor to create a TestController component, and then binding
     * any associated HTML controls to the new component.
     */
    static init()
    {
        let aeTest = Component.getElementsByClass(document, PCX86.APPCLASS, "testctl");
        for (let iTest = 0; iTest < aeTest.length; iTest++) {
            let eTest = aeTest[iTest];
            let parms = Component.getComponentParms(eTest);
            let test = new TestController(parms);
            Component.bindComponentControls(test, eTest, PCX86.APPCLASS);
        }
    }
}

/*
 * Initialize every TestController module on the page.
 */
Web.onInit(TestController.init);

if (typeof module !== "undefined") module.exports = TestController;
