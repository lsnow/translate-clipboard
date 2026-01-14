import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Clutter from 'gi://Clutter';
import Graphene from 'gi://Graphene';
import St from 'gi://St';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Button } from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import { notify } from 'resource:///org/gnome/shell/ui/main.js';

import * as Utils from './utils.js';
import * as Languages from './languages.js';
import { AzureTTS } from './tts.js';
import { GoogleTranslator } from './google.js';
import { providers as Providers, AiTranslator } from './llm.js';
import { Fields, defaultConfig } from './config/constants.js';
import { TranslateWindow } from './TranslateWindow.js';

const IndicatorName = 'Translate Clipboard';

export const TcIndicator = GObject.registerClass(
    class TcIndicator extends Button {
        _init(ext) {
            super._init(0.0, IndicatorName, false);

            this._extension = ext;
            this._settings = this._extension.getSettings();
            this._trans_cmd = ext.path + '/trans';

            this._enabled = true;
            this._oldtext = null;
            this._showOriginalPhonetics = true;
            this._autoClose = this._settings.get_boolean(Fields.AUTO_CLOSE);
            this._autoHideMode = this._settings.get_string(Fields.AUTO_HIDE_MODE) || 'timeout';
            this._engine = this._settings.get_string(Fields.ENGINE);
            this._dump = true;
            this._ttsEngine = this._settings.get_string(Fields.TTS_ENGINE);
            this._proxy = this._settings.get_string(Fields.PROXY);
            this._briefMode = this._settings.get_boolean(Fields.BRIEF_MODE);

            this._locale = this._getLocale();

            this._icon = new St.Icon({
                style_class: 'system-status-icon',
            });
            this._icon.gicon = Gio.icon_new_for_string(`${this._extension.path}/icons/translator-symbolic.svg`);
            let box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
            box.add_child(this._icon);
            this.add_child(box);

            let codes = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false
            });
            this._from = new St.Entry({
                x_align: Clutter.ActorAlign.START,
                hint_text: _("Auto")
            });
            this._to = new St.Entry({
                x_align: Clutter.ActorAlign.END,
                hint_text: _("Auto")
            });
            let l = new St.Label({
                text: "->",
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER
            });
            codes.add_child(this._from);
            codes.add_child(l);
            codes.add_child(this._to);
            this.menu.addMenuItem(codes);
            this._from.clutter_text.connect('key-focus-out', () => {
                if (this._from.text == '')
                    this._from.text == 'auto';
                this._settings.set_string(Fields.FROM, this._from.text);
            });
            this._to.clutter_text.connect('key-focus-out', () => {
                if (this._to.text == '')
                    this._to.text == 'auto';
                this._settings.set_string(Fields.TO, this._to.text);
            });

            let item = new PopupMenu.PopupSwitchMenuItem(_('Toggle translate'), true, null);
            item.connect('toggled', () => {
                this._enabled = item.state;
                this._settings.set_boolean(Fields.ENABLE_TRANS, this._enabled);
            });
            this.menu.addMenuItem(item);
            this._enableTransItem = item;

            let item1 = new PopupMenu.PopupSwitchMenuItem(_('Brief mode'), false, null);
            item1.connect('toggled', () => {
                this._briefMode = item1.state;
                this._settings.set_boolean(Fields.BRIEF_MODE, this._briefMode);
            });
            this.menu.addMenuItem(item1);
            this._briefModeItem = item1;

            let keybind = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false
            });
            keybind.add_child(new St.Label({
                text: "Translate selected",
                x_align: Clutter.ActorAlign.START
            }));
            let key0 = this._settings.get_strv(Fields.TRANS_SELECTED)[0];
            keybind.add_child(new St.Label({
                text: key0,
                x_expand: true,
                x_align: Clutter.ActorAlign.END
            }));

            this.menu.addMenuItem(keybind);

            let settingsItem = new PopupMenu.PopupMenuItem('Settings');
            this.menu.addMenuItem(settingsItem);
            settingsItem.connect('activate', this._openPrefs.bind(this));

            this._settingsChangedId = this._settings.connect('changed', () => {
                this._settingsChanged();
            });
            this._tts = new AzureTTS(null);
            this._tts.engine = this._ttsEngine;
            
            this._translateWindow = new TranslateWindow({
                extension: this._extension,
                tts: this._tts,
                engine: this._engine,
                briefMode: this._briefMode,
                dump: this._dump,
                autoClose: this._autoClose,
                autoHideMode: this._autoHideMode,
                locale: this._locale,
                fromEntry: this._from,
                toEntry: this._to,
                translateCallback: (text) => {
                    this._translate(text);
                },
                isRtl: (code) => {
                    return this._isRtl(code);
                }
            });
            
            this._settingsChanged();
            this._watchClipboard();
        }

        destroy() {
            this._removeKeybindings();
            this._selection.disconnect(this._ownerChangedId);
            this._settings.disconnect(this._settingsChangedId);
            if (this._translateWindow) {
                this._translateWindow.destroy();
                this._translateWindow = null;
            }
            this._tts.cleanup();

            super.destroy();
        }

        _openPrefs() {
            this._extension.openPreferences();
        }

        _settingsChanged() {
            this._oldtext = null;
            this._enableTransItem.setToggleState(this._settings.get_boolean(Fields.ENABLE_TRANS));
            this._briefModeItem.setToggleState(this._settings.get_boolean(Fields.BRIEF_MODE));
            this._enabled = this._enableTransItem.state;
            this._briefMode = this._briefModeItem.state;
            this._autoClose = this._settings.get_boolean(Fields.AUTO_CLOSE);
            this._autoHideMode = this._settings.get_string(Fields.AUTO_HIDE_MODE) || 'timeout';
            this._ttsEngine = this._settings.get_string(Fields.TTS_ENGINE);
            this._tts.engine = this._ttsEngine;
            this._proxy = this._settings.get_string(Fields.PROXY);
            this._engine = this._settings.get_string(Fields.ENGINE);

            if (this._translateWindow) {
                this._translateWindow.updateSettings({
                    engine: this._engine,
                    briefMode: this._briefMode,
                    dump: this._dump,
                    autoClose: this._autoClose,
                    autoHideMode: this._autoHideMode,
                    locale: this._locale
                });
            }

            let from = this._settings.get_string(Fields.FROM);
            let to = this._settings.get_string(Fields.TO);

            let isoLangs = Languages.isoLangs;

            if (from == '')
                from = 'auto';
            else
                from = this._getCode(from);

            if (to == '' || to.toLowerCase() == 'auto')
                to = this._getCode(this.locale);
            else
                to = this._getCode(to);

            this._from.set_text(from);
            this._to.set_text(to);
            this._removeKeybindings();
            this._setupKeybindings();
            
            if (this._translator && this._translateCompleted) {
                this._translator.disconnect(this._translateCompleted);
                this._translateCompleted = null;
            }
            
            if (this._engine != 'Google')
                this._onProviderChanged();
            else
                this._translator = new GoogleTranslator();
            this._translateCompleted = this._translator.connect('completed',
                this._onCompleted.bind(this));
            this._translator.connect('error', (object, error) => { notify(IndicatorName, error); });
        }

        _onProviderChanged() {
            const provider = this._settings.get_string(Fields.LLM_PROVIDER);
            try {
                for (const p in Providers) {
                    if (Providers[p].name == provider) {
                        let providerSettings = Utils.readConfig(this._settings, Fields.PROVIDER_SETTINGS)[p] ?? defaultConfig;
                        providerSettings.provider = p;
                        providerSettings.schema = this._settings.schema_id;
                        this._translator = new AiTranslator(providerSettings);
                        break;
                    }
                }
            } catch (e) {
                this._engine = 'Google';
                this._translator = new GoogleTranslator();
            }
        }

        _removeKeybindings() {
            Main.wm.removeKeybinding('translate-selected-text');
        }

        _setupKeybindings() {
            Main.wm.addKeybinding('translate-selected-text',
                this._settings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL |
                Shell.ActionMode.POPUP,
                this._translateSelected.bind(this));
        }

        _translateSelected() {
            let [x, y, mods] = global.get_pointer();
            [this._x, this._y] = [x, y];
            this._clipboard.get_text(St.ClipboardType.PRIMARY,
                (clipboard, text) => {
                    if (text && text != '' &&
                        text[0] != '/' &&
                        !Util.findUrls(text).length &&
                        !RegExp(/^[\.\s\d\-]+$/).exec(text)) {
                        this._oldtext = text;
                        if (this._translateWindow) {
                            this._translateWindow.showLoading(this._x, this._y, text);
                        }
                        this._translate(text);
                    } else {
                        if (this._translateWindow && this._translateWindow._actor) {
                            this._translateWindow._close();
                        }
                    }
                });
        }

        _watchClipboard() {
            this._selection = global.display.get_selection();
            this._clipboard = St.Clipboard.get_default();
            this._ownerChangedId = this._selection.connect('owner-changed', () => {
                if (this._enabled) {
                    let [x, y, mods] = global.get_pointer();
                    let buttonMask = Clutter.ModifierType.BUTTON1_MASK |
                        Clutter.ModifierType.BUTTON2_MASK |
                        Clutter.ModifierType.BUTTON3_MASK |
                        Clutter.ModifierType.SHIFT_MASK |
                        Clutter.ModifierType.CONTROL_MASK |
                        Clutter.ModifierType.SUPER_MASK;
                    if (buttonMask & mods)
                        return;
                    this._clipboardChanged();
                }
            });
        }

        _clipboardChanged() {
            [this._x, this._y] = global.get_pointer();
            this._clipboard.get_text(St.ClipboardType.PRIMARY,
                (clipboard, text) => {
                    if (text && text != '' &&
                        text[0] != '/' &&
                        //RegExp(/\S+/).exec(text) &&
                        !Util.findUrls(text).length &&
                        !RegExp(/^[\.\s\d\-]+$/).exec(text)) {
                        this._oldtext = text;
                        if (this._translateWindow) {
                            this._translateWindow.showLoading(this._x, this._y, text);
                        }
                        this._translate(text);
                    } else {
                        if (this._translateWindow && this._translateWindow._actor) {
                            this._translateWindow._close();
                        }
                    }
                });
        }

        _onCompleted(emitter, result) {
            let [x, y] = [this._x, this._y];
            if (this._translateWindow) {
                this._translateWindow.showResult(result, x, y);
            }
        }


        _getLocale() {
            this.locale = GLib.get_language_names()[0];

            if (this.locale == 'C')
                this.locale = 'en';
            this.locale = this.locale.replace('_', '-');
        }

        _getCode(lang) {
            let isoLangs = Languages.isoLangs;
            lang = lang.replace('_', '-');
            let code = isoLangs[lang];
            if (code == undefined) {
                let codes = [lang, lang.split('-')[0]];
                for (let [i, c] of codes.entries()) {
                    let l = Object.keys(isoLangs).find(key =>
                    ((key.indexOf(c) != -1) ||
                        (isoLangs[key].name.indexOf(c) != -1) ||
                        (isoLangs[key].nativeName.indexOf(c) != -1)));
                    if (l != undefined)
                        return l;
                }
                return 'en';
            }
            else {
                return lang;
            }
        }

        _isRtl(code) {
            var rtlCodes = ['ar', 'he', 'ps', 'fa', 'sd', 'ur', 'yi', 'ug'];
            return rtlCodes.indexOf(code) != -1;
        }



        _translate(text) {
            this._translator.translate(this._from.text, this._to.text, this._proxy, text);
        }
    });

