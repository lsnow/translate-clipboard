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
            this._detectingLanguage = false;
            this._pendingText = null;

            this._locale = this._getLocale();

            this._icon = new St.Icon({
                style_class: 'system-status-icon',
            });
            this._icon.gicon = Gio.icon_new_for_string(`${this._extension.path}/icons/translator-symbolic.svg`);
            let box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
            box.add_child(this._icon);
            this.add_child(box);

            this._createLanguageSelector(Fields.FROM, _("Source language"), 'auto');
            this._createLanguageSelector(Fields.TO_PRIMARY, _("Primary target language"), 'auto');
            this._createLanguageSelector(Fields.TO_SECONDARY, _("Secondary target language"), '');

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
                settings: this._settings,
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
            let toPrimary = this._settings.get_string(Fields.TO_PRIMARY);
            let toSecondary = this._settings.get_string(Fields.TO_SECONDARY);

            let isoLangs = Languages.isoLangs;

            if (from == '')
                from = 'auto';
            else
                from = this._getCode(from);

            if (to == '' || to.toLowerCase() == 'auto')
                to = this._getCode(this.locale);
            else
                to = this._getCode(to);

            if (toPrimary == '' || toPrimary.toLowerCase() == 'auto')
                toPrimary = this._getCode(this.locale);
            else
                toPrimary = this._getCode(toPrimary);

            if (toSecondary == '' || toSecondary.toLowerCase() == 'auto')
                toSecondary = '';
            else
                toSecondary = this._getCode(toSecondary);

            this._toPrimary = toPrimary;
            this._toSecondary = toSecondary;
            
            // Update the language selector value display
            if (this._fromSelector && this._fromSelector.valueLabel) {
                this._updateLanguageSelectorValue(this._fromSelector.valueLabel, from);
                if (this._fromSelector.menuItems) {
                    this._updateMenuSelection(this._fromSelector.subMenu, this._fromSelector.menuItems, from);
                }
            }
            if (this._toPrimarySelector && this._toPrimarySelector.valueLabel) {
                this._updateLanguageSelectorValue(this._toPrimarySelector.valueLabel, toPrimary);
                if (this._toPrimarySelector.menuItems) {
                    this._updateMenuSelection(this._toPrimarySelector.subMenu, this._toPrimarySelector.menuItems, toPrimary);
                }
            }
            if (this._toSecondarySelector && this._toSecondarySelector.valueLabel) {
                this._updateLanguageSelectorValue(this._toSecondarySelector.valueLabel, toSecondary);
                if (this._toSecondarySelector.menuItems) {
                    this._updateMenuSelection(this._toSecondarySelector.subMenu, this._toSecondarySelector.menuItems, toSecondary);
                }
            }
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
            // If detecting language, extract the detected language from the result
            if (this._detectingLanguage) {
                try {
                    let json = JSON.parse(result);
                    let detectedLang = json[2]; // Google Translate API returns the detected language code
                    
                    // Select the appropriate target language
                    let targetLang = this._selectTargetLanguage(detectedLang);
                    
                    if (targetLang === null) {
                        if (this._translateWindow) {
                            let [x, y] = [this._x, this._y];
                            let originalText = this._pendingText;
                            this._translateWindow.showResult(JSON.stringify([[[originalText, originalText, null, null, 0]], null, detectedLang]), x, y);
                        }
                        this._detectingLanguage = false;
                        this._pendingText = null;
                        return;
                    }
                    
                    this._detectingLanguage = false;
                    let text = this._pendingText;
                    this._pendingText = null;
                    this._translator.translate(detectedLang, targetLang, this._proxy, text);
                    return;
                } catch (error) {
                    log('Failed to parse detection result: ' + error);
                    this._detectingLanguage = false;
                    this._pendingText = null;
                }
            }
            
            let [x, y] = [this._x, this._y];
            if (this._translateWindow) {
                this._translateWindow.showResult(result, x, y);
            }
        }

        _selectTargetLanguage(detectedLang) {
            // Normalize the detected language code (remove the region suffix, e.g. zh-CN -> zh)
            let detectedBase = detectedLang.split('-')[0];
            
            if (this._toPrimary && this._toPrimary !== '') {
                let primaryBase = this._toPrimary.split('-')[0];
                if (detectedBase === primaryBase || detectedLang === this._toPrimary) {
                    if (this._toSecondary && this._toSecondary !== '') {
                        let secondaryBase = this._toSecondary.split('-')[0];
                        if (detectedBase === secondaryBase || detectedLang === this._toSecondary) {
                            return null;
                        }
                        return this._toSecondary;
                    }
                    return null;
                }
                return this._toPrimary;
            }
            
            // If there is no primary target language, check the secondary target language
            if (this._toSecondary && this._toSecondary !== '') {
                let secondaryBase = this._toSecondary.split('-')[0];
                if (detectedBase === secondaryBase || detectedLang === this._toSecondary) {
                    return null;
                }
                return this._toSecondary;
            }
            
            // If there is no target language, use the default to
            let defaultTo = this._settings.get_string(Fields.TO);
            if (defaultTo && defaultTo !== 'auto' && defaultTo !== '') {
                let toBase = defaultTo.split('-')[0];
                if (detectedBase === toBase || detectedLang === defaultTo) {
                    return null;
                }
                return defaultTo;
            }
            
            return null;
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

        _createLanguageSelector(field, label, defaultValue) {
            let isoLangs = Languages.isoLangs;
            let currentValue = this._settings.get_string(field) || defaultValue;
            
            let subMenu = new PopupMenu.PopupSubMenuMenuItem(label);
            this.menu.addMenuItem(subMenu);
            
            let subMenuItem = subMenu.actor;
            let originalLabel = subMenu.label;
            
            if (subMenu._arrow) {
                subMenu._arrow.hide();
            }
            
            let labelWidget = new St.Label({
                text: label,
                x_align: Clutter.ActorAlign.START,
                style_class: 'tc-language-label'
            });
            
            let valueLabel = new St.Label({
                text: '',
                x_align: Clutter.ActorAlign.START,
                style_class: 'tc-language-value'
            });
            valueLabel.style = 'font-size: 0.9em;';
            
            let arrowIcon = new St.Icon({
                icon_name: 'pan-down-symbolic',
                icon_size: 16,
                style_class: 'tc-language-arrow'
            });
            
            let box = new St.BoxLayout({
                vertical: false,
                x_expand: true
            });
            
            if (originalLabel && originalLabel.get_parent()) {
                originalLabel.get_parent().remove_child(originalLabel);
            }
            let children = subMenuItem.get_children();
            for (let i = 0; i < children.length; i++) {
                subMenuItem.remove_child(children[i]);
            }
            
            let leftBox = new St.BoxLayout({
                vertical: true,
                x_align: Clutter.ActorAlign.START,
                x_expand: true
            });
            leftBox.add_child(labelWidget);
            leftBox.add_child(valueLabel);
            
            arrowIcon.x_expand = false;
            arrowIcon.x_align = Clutter.ActorAlign.END;
            
            box.add_child(leftBox);
            box.add_child(arrowIcon);
            
            box.style = 'padding-left: 0px; margin-left: 0px;';
            
            subMenuItem.add_child(box);
            
            subMenu.menu.connect('open-state-changed', (menu, isOpen) => {
                if (isOpen) {
                    arrowIcon.icon_name = 'pan-up-symbolic';
                } else {
                    arrowIcon.icon_name = 'pan-down-symbolic';
                }
            });
            
            // 存储菜单项引用以便更新选中状态
            let menuItems = {};
            
            if (field === Fields.FROM || field === Fields.TO_PRIMARY) {
                let autoItem = new PopupMenu.PopupMenuItem(_("Auto"));
                autoItem.connect('activate', () => {
                    this._settings.set_string(field, 'auto');
                    this._updateLanguageSelectorValue(valueLabel, 'auto');
                    this._updateMenuSelection(subMenu, menuItems, 'auto');
                    subMenu.menu.close();
                });
                subMenu.menu.addMenuItem(autoItem);
                menuItems['auto'] = autoItem;
            }
            
            if (field === Fields.TO_SECONDARY) {
                let noneItem = new PopupMenu.PopupMenuItem(_("None"));
                noneItem.connect('activate', () => {
                    this._settings.set_string(field, '');
                    this._updateLanguageSelectorValue(valueLabel, '');
                    this._updateMenuSelection(subMenu, menuItems, '');
                    subMenu.menu.close();
                });
                subMenu.menu.addMenuItem(noneItem);
                menuItems[''] = noneItem;
            }
            
            if (field === Fields.FROM || field === Fields.TO_PRIMARY || field === Fields.TO_SECONDARY) {
                subMenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            }
            
            let langKeys = Object.keys(isoLangs).sort((a, b) => {
                let nameA = isoLangs[a].name.toLowerCase();
                let nameB = isoLangs[b].name.toLowerCase();
                return nameA.localeCompare(nameB);
            });
            
            for (let langCode of langKeys) {
                let lang = isoLangs[langCode];
                let displayName = `${lang.name} (${langCode})`;
                let langItem = new PopupMenu.PopupMenuItem(displayName);
                langItem.connect('activate', () => {
                    this._settings.set_string(field, langCode);
                    this._updateLanguageSelectorValue(valueLabel, langCode);
                    this._updateMenuSelection(subMenu, menuItems, langCode);
                    subMenu.menu.close();
                });
                subMenu.menu.addMenuItem(langItem);
                menuItems[langCode] = langItem;
            }
            
            // 更新显示当前值并标记选中项
            this._updateLanguageSelectorValue(valueLabel, currentValue);
            this._updateMenuSelection(subMenu, menuItems, currentValue);
            
            // 存储菜单项引用以便后续更新
            if (field === Fields.FROM) {
                this._fromSelector = { menuItem: subMenuItem, valueLabel, subMenu, menuItems };
            } else if (field === Fields.TO_PRIMARY) {
                this._toPrimarySelector = { menuItem: subMenuItem, valueLabel, subMenu, menuItems };
            } else if (field === Fields.TO_SECONDARY) {
                this._toSecondarySelector = { menuItem: subMenuItem, valueLabel, subMenu, menuItems };
            }
        }

        _updateMenuSelection(subMenu, menuItems, selectedValue) {
            if (!menuItems) return;
            
            // 清除所有菜单项的选中标记
            for (let key in menuItems) {
                let item = menuItems[key];
                if (item && item.setOrnament) {
                    item.setOrnament(PopupMenu.Ornament.NONE);
                }
            }
            
            // 标记当前选中的项
            let selectedItem = menuItems[selectedValue];
            if (selectedItem && selectedItem.setOrnament) {
                selectedItem.setOrnament(PopupMenu.Ornament.DOT);
            }
        }

        _updateLanguageSelectorValue(valueLabel, value) {
            if (!valueLabel) return;
            
            let displayValue = '';
            if (value === '' || value === null) {
                displayValue = _("None");
            } else if (value === 'auto') {
                displayValue = _("Auto");
            } else {
                let isoLangs = Languages.isoLangs;
                let lang = isoLangs[value];
                if (lang) {
                    displayValue = lang.name;
                } else {
                    displayValue = value;
                }
            }
            
            valueLabel.text = displayValue;
        }



        _translate(text) {
            let from = this._settings.get_string(Fields.FROM) || 'auto';
            
            if (from === 'auto' && this._toPrimary && this._toPrimary !== '') {
                this._detectingLanguage = true;
                this._pendingText = text;
                this._translator.translate('auto', this._toPrimary, this._proxy, text);
            } else if (from === 'auto' && this._toSecondary && this._toSecondary !== '') {
                this._detectingLanguage = true;
                this._pendingText = text;
                this._translator.translate('auto', this._toSecondary, this._proxy, text);
            } else {
                if (this._toPrimary && this._toPrimary !== '') {
                    let targetLang = this._selectTargetLanguage(from);
                    if (targetLang === null) {
                        if (this._translateWindow) {
                            let [x, y] = [this._x, this._y];
                            let originalText = text;
                            this._translateWindow.showResult(JSON.stringify([[[originalText, originalText, null, null, 0]], null, from]), x, y);
                        }
                        return;
                    }
                    this._translator.translate(from, targetLang, this._proxy, text);
                } else {
                    let targetLang = this._toPrimary || this._settings.get_string(Fields.TO) || this._locale;
                    this._translator.translate(from, targetLang, this._proxy, text);
                }
            }
        }
    });

