/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */

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
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Button} from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import {notify} from 'resource:///org/gnome/shell/ui/main.js';

import * as Utils from './utils.js';
import * as Languages from './languages.js';
import {AzureTTS} from './tts.js';
import {GoogleTranslator} from './google.js';
import {providers as Providers, AiTranslator} from './llm.js';

const GETTEXT_DOMAIN = 'translate-clipboard-extension';
const IndicatorName = 'Translate Clipboard';

let tcIndicator = null;

const TcIndicator = GObject.registerClass(
class TcIndicator extends Button {
    _init(ext) {
        super._init(0.0, IndicatorName, false);

        this._extension = ext;
        this._settings = this._extension.getSettings();
        this._trans_cmd = ext.path + '/trans';

        this._enabled = true;
        this._oldtext = null;
        this._showOriginalPhonetics = true;
        this._autoClose = true;
        this._autoHideMode = 'timeout';
        this._engine = 'google';
        this._dump = true;
        this._ttsEngine = 'Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoXiaoNeural)';
        this._proxy = '';
        this._clickHandlerId = null;
        this._clickPollId = null;
        this._lastMouseState = null;

        this._locale = this._getLocale();

        this._icon = new St.Icon({
            style_class: 'system-status-icon',
        });
        this._icon.gicon = Gio.icon_new_for_string(`${this._extension.path}/icons/translator-symbolic.svg`);
        let box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        box.add_child(this._icon);
        this.add_child(box);

        let codes = new PopupMenu.PopupBaseMenuItem({reactive : false,
                                                     can_focus : false});
        this._from = new St.Entry({x_align : Clutter.ActorAlign.START,
                                   hint_text : _("Auto")});
        this._to = new St.Entry({x_align : Clutter.ActorAlign.END,
                                 hint_text : _("Auto")});
        let l = new St.Label ({text: "->",
                               x_expand: true,
                               x_align: Clutter.ActorAlign.CENTER,
                               y_align: Clutter.ActorAlign.CENTER});
        codes.add_child(this._from);
        codes.add_child(l);
        codes.add_child(this._to);
        this.menu.addMenuItem(codes);
        this._from.clutter_text.connect('key-focus-out', ()=> {
            if (this._from.text == '')
                this._from.text == 'auto';
            this._settings.set_string(Utils.Fields.FROM, this._from.text);
        });
        this._to.clutter_text.connect('key-focus-out', ()=> {
            if (this._to.text == '')
                this._to.text == 'auto';
            this._settings.set_string(Utils.Fields.TO, this._to.text);
        });

        let item = new PopupMenu.PopupSwitchMenuItem(_('Toggle translate'), true, null);
        item.connect('toggled', () => {
            this._enabled = item.state;
            this._settings.set_boolean(Utils.Fields.ENABLE_TRANS, this._enabled);
        });
        this.menu.addMenuItem(item);
        this._enableTransItem = item;

        let item1 = new PopupMenu.PopupSwitchMenuItem(_('Brief mode'), false, null);
        item1.connect('toggled', () => {
            this._briefMode = item1.state;
            this._settings.set_boolean(Utils.Fields.BRIEF_MODE, this._briefMode);
        });
        this.menu.addMenuItem(item1);
        this._briefModeItem = item1;

        let keybind = new PopupMenu.PopupBaseMenuItem({reactive : false,
                                                       can_focus : false});
        keybind.add_child(new St.Label({text: "Translate selected",
                                       x_align: Clutter.ActorAlign.START}));
        let key0 = this._settings.get_strv(Utils.Fields.TRANS_SELECTED)[0];
        keybind.add_child(new St.Label({text: key0,
                                       x_expand: true,
                                       x_align: Clutter.ActorAlign.END}));

        this.menu.addMenuItem(keybind);

        let settingsItem = new PopupMenu.PopupMenuItem('Settings');
        this.menu.addMenuItem(settingsItem);
        settingsItem.connect('activate', this._openPrefs.bind(this));

        this._settingsChangedId = this._settings.connect('changed', () => {
            this._settingsChanged();
        });
        this._tts = new AzureTTS(null);
        this._settingsChanged();
        this._watchClipboard();
    }

    destroy() {
        this._removeKeybindings();
        this._selection.disconnect(this._ownerChangedId);
        this._settings.disconnect(this._settingsChangedId);
        this._removeClickHandler();
        if (this._actor)
            this._actor.destroy();
        if (this._popupTimeoutId) {
            GLib.source_remove(this._popupTimeoutId);
            this._popupTimeoutId = 0;
        }
        this._tts.cleanup();

        super.destroy();
    }

    _openPrefs() {
        this._extension.openPreferences();
    }

    _settingsChanged() {
        this._oldtext = null;
        this._enableTransItem.setToggleState(this._settings.get_boolean(Utils.Fields.ENABLE_TRANS));
        this._briefModeItem.setToggleState(this._settings.get_boolean(Utils.Fields.BRIEF_MODE));
        this._enabled = this._enableTransItem.state;
        this._briefMode = this._briefModeItem.state;
        this._autoClose = this._settings.get_boolean(Utils.Fields.AUTO_CLOSE);
        this._autoHideMode = this._settings.get_string(Utils.Fields.AUTO_HIDE_MODE) || 'timeout';

        // 如果窗口已经显示，需要更新隐藏方式
        if (this._actor && this._actor.visible) {
            this._updateHideBehavior();
        }

        let from = this._settings.get_string(Utils.Fields.FROM);
        let to = this._settings.get_string(Utils.Fields.TO);

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
        this._ttsEngine = this._settings.get_string(Utils.Fields.TTS_ENGINE);
        this._tts.engine = this._ttsEngine;
        this._proxy = this._settings.get_string(Utils.Fields.PROXY);
        this._engine = this._settings.get_string(Utils.Fields.ENGINE);
        if (this._engine != 'Google')
            this._onProviderChanged();
        else
            this._translator = new GoogleTranslator();
        this._translateCompleted = this._translator.connect('completed',
            this._onCompleted.bind(this));
        this._translator.connect('error', (object, error) => { notify(IndicatorName, error); });
    }

    _onProviderChanged() {
        const provider = this._settings.get_string(Utils.Fields.LLM_PROVIDER);
        try {
            for (const p in Providers) {
                if (Providers[p].name == provider) {
                    let providerSettings = Utils.readConfig(this._settings, Utils.Fields.PROVIDER_SETTINGS)[p] ?? Utils.defaultConfig;
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
        this._clipboardChanged();
    }

    _watchClipboard() {
        this._selection = global.display.get_selection();
        this._clipboard = St.Clipboard.get_default();
        this._ownerChangedId = this._selection.connect('owner-changed', () => {
            if (this._enabled)
            {
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
        this._clipboard.get_text(St.ClipboardType.PRIMARY,
            (clipboard, text) => {
                if (text && text != '' &&
                    text[0] != '/' &&
                    //RegExp(/\S+/).exec(text) &&
                    !Util.findUrls(text).length &&
                    !RegExp(/^[\.\s\d\-]+$/).exec(text)) {
                    this._oldtext = text;
                    [this._x, this._y] = global.get_pointer();
                    this._translate(text);
                }
            });
    }

    _onCompleted(emitter, result) {
        let [x, y] = [this._x, this._y];//global.get_pointer();
        if (!this._actor)
        {
            this._actor = new St.Widget();
            this._scroll = new St.ScrollView({ style_class: "translate-scroll",
                                              hscrollbar_policy: St.PolicyType.AUTOMATIC,
                                              vscrollbar_policy: St.PolicyType.AUTOMATIC,
            });
            this._actor.add_child(this._scroll);
            this._box = new St.BoxLayout({ style_class: "translate-box",
                                           vertical: true,
                                           x_expand: true,
                                           y_expand: true });
            this._scroll.add_child(this._box);

            let closeIcon = new St.Icon({ icon_name: 'window-close-symbolic',
                                        icon_size: 24 });
            this._closeButton = new St.Button({
                                              style_class: 'message-close-button',
                                              child: closeIcon,
            });
            this._actor.add_child(this._closeButton);
            this._closeButton.connect('clicked', this._close.bind(this));

            this._closeButton.add_constraint(new Clutter.BindConstraint({
                                                                        source: this._box,
                                                                        coordinate: Clutter.BindCoordinate.POSITION,
            }));
            this._closeButton.add_constraint(new Clutter.AlignConstraint({
                                                                         source: this._box,
                                                                         align_axis: Clutter.AlignAxis.X_AXIS,
                                                                         pivot_point: new Graphene.Point({ x: 0, y: -1 }),
                                                                         factor: 0,
            }));

            Main.layoutManager.addChrome(this._actor, {affectsInputRegion: true});
        }
        if (this._autoClose)
        {
            this._closeButton.hide();
            this._box.reactive = false;
        }
        else
        {
            this._closeButton.show();
            this._box.reactive = true;
        }
        if (this._popupTimeoutId) {
            GLib.source_remove(this._popupTimeoutId);
            this._popupTimeoutId = 0;
        }
        if (!this._dump) {
            this._label = new St.Label();
            this._label.clutter_text.set_line_wrap(true);
            this._label.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
            this._box.add_child(this._label);
            this._label.clutter_text.set_markup(result);
        } else {
            this._parseResult(result);
        }

        let monitor = Main.layoutManager.currentMonitor;
        const { scale_factor: scaleFactor } = St.ThemeContext.get_for_stage(global.stage);
        this._scroll.set_style(
                               'max-height: %spx; max-width: %spx;'.format(monitor.height/scaleFactor/2,
                                                                           monitor.width/scaleFactor/2));
        let natWidth = this._scroll.get_preferred_width(-1)[1];
        if (x + natWidth > monitor.x + monitor.width)
        {
            y = monitor.x + monitor.width - natWidth;
        }

        let natHeight = this._scroll.get_preferred_height(-1)[1];
        if (y + 10 + natHeight > monitor.y + monitor.height)
        {
            y = monitor.y + monitor.height - natHeight;
        }

        this._actor.set_position(x, y + 10);
        this._actor.show();
        this._updateHideBehavior();
    }

    _updateHideBehavior() {
        // 清除之前的隐藏设置
        this._removeClickHandler();
        this._updatePopupTimeout(0);

        // 根据自动隐藏模式设置相应的隐藏方式
        if (this._autoClose) {
            if (this._autoHideMode === 'click' || this._autoHideMode === 'both') {
                this._setupClickHandler();
            }
            if (this._autoHideMode === 'timeout' || this._autoHideMode === 'both') {
                this._updatePopupTimeout(5000);
            }
        } else {
            // 即使自动关闭关闭，如果模式是 click，也启用点击隐藏
            if (this._autoHideMode === 'click' || this._autoHideMode === 'both') {
                this._setupClickHandler();
            }
        }
    }

    _getLocale () {
        this.locale = GLib.get_language_names()[0];

        if (this.locale == 'C')
            this.locale = 'en';
        this.locale = this.locale.replace('_', '-');
    }

    _getCode (lang) {
        let isoLangs = Languages.isoLangs;
        lang = lang.replace('_', '-');
        let code = isoLangs[lang];
        if (code == undefined)
        {
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

    _isRtl (code) {
        var rtlCodes = ['ar', 'he', 'ps', 'fa', 'sd', 'ur', 'yi', 'ug'];
        return rtlCodes.indexOf(code) != -1;
    }

    _close() {
        this._removeClickHandler();
        this._actor.hide();
        if (this._label) {
            this._label.destroy();
            this._label = null;
        }
        if (this._resBox) {
            //this._box.remove_child(this._resBox);
            this._resBox.destroy();
            this._resBox = null;
        }
    }

    _isPointerInsideWindow() {
        if (!this._actor || !this._actor.visible)
            return false;

        let [x, y] = global.get_pointer();
        let [x_, y_] = this._actor.get_transformed_position();
        let [w_, h_] = this._actor.get_transformed_size();
        return x > x_ && y > y_ &&
               x < x_ + w_ && y < y_ + h_;
    }

    _popupTimeout() {
        if (this._isPointerInsideWindow()) {
            this._updatePopupTimeout(1000);
            return;
        }

        this._removeClickHandler();
        this._actor.hide();
        if (this._label) {
            this._label.destroy();
            this._label = null;
        }
        if (this._resBox) {
            this._resBox.destroy();
            this._resBox = null;
        }
        this._popupTimeoutId = 0;
        return GLib.SOURCE_REMOVE;
    }

    _updatePopupTimeout(timeout) {
         if (this._popupTimeoutId) {
             GLib.source_remove(this._popupTimeoutId);
             this._popupTimeoutId = 0;
         }
         if (timeout > 0) {
             this._popupTimeoutId =
                 GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeout,
                     this._popupTimeout.bind(this));
             GLib.Source.set_name_by_id(this._popupTimeoutId, '[gnome-shell] this._popupTimeout');
         }
     }

    _setupClickHandler() {
        this._removeClickHandler();
        if (!this._actor || !this._actor.visible)
            return;

        let currentFocusWindow = global.display.get_focus_window();
        let workspace = global.display.get_workspace_manager().get_active_workspace();
        let windows = workspace.list_windows();
        
        let targetWindow = null;
        for (let i = 0; i < windows.length; i++) {
            let win = windows[i];
            if (win !== currentFocusWindow) {
                targetWindow = win;
                if (win.title && win.title.includes('Desktop')) {
                    break;
                }
            }
        }
        
        if (targetWindow) {
            targetWindow.focus(global.get_current_time());
        }
        
        this._clickHandlerId = global.display.connect('focus-window',
            this._onFocusWindow.bind(this));
    }

    _removeClickHandler() {
        if (this._clickHandlerId) {
            global.display.disconnect(this._clickHandlerId);
            this._clickHandlerId = null;
        }
    }

    _onFocusWindow(display, window) {
        if (!this._actor || !this._actor.visible)
            return;

        if (this._autoHideMode !== 'click' && this._autoHideMode !== 'both')
            return;

        if (this._isPointerInsideWindow()) {
            return;
        }

        this._close();
    }

    _createLabelWidget (str1, str2, rtl1, rtl2) {
        let box = new St.BoxLayout({vertical: rtl1 || rtl2});
        let label1 = new St.Label({text: str1 + ' : ',
                                  style_class: 'tc-normal-label'
        });
        let label2 = new St.Label({text: str2,
                                  style_class: 'tc-normal-label'
        });
        if (rtl1)
            label1.add_style_pseudo_class('rtl');
        if (rtl2)
            label2.add_style_pseudo_class('rtl');
        box.add_child(label1);
        box.add_child(label2);

        return box;
    }

    /* parse markdown to pango markup */
    _md2pango (origin) {
        if (!origin || typeof origin !== 'string') {
            return origin;
        }

        let result = origin;

        // Convert markdown bold (**text** or __text__) to pango bold
        result = result.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
        result = result.replace(/__(.*?)__/g, '<b>$1</b>');

        // Convert markdown italic (*text* or _text_) to pango italic
        result = result.replace(/\*(.*?)\*/g, '<i>$1</i>');
        result = result.replace(/_(.*?)_/g, '<i>$1</i>');

        // Convert markdown headers (# text) to pango large/bold
        result = result.replace(/^### (.*$)/gm, '<b>$1</b>');
        result = result.replace(/^## (.*$)/gm, '<big><b>$1</b></big>');
        result = result.replace(/^# (.*$)/gm, '<span size="large"><b>$1</b></span>');

        // Escape remaining XML characters that aren't part of markup
        result = result.replace(/&(?!(?:lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');
        result = result.replace(/<(?!\/?(?:b|i|u|s|tt|big|small|span|sup|sub)(?:\s|>))/g, '&lt;');
        return result;
    }

    _parseResult (result) {
        if (this._resBox) {
            //this._box.remove_child(this._resBox);
            this._resBox.destroy();
            this._resBox = null;
        }
        try {
            this._resBox = new St.BoxLayout({vertical: true,
                                            style_class: 'tc-result-box'
            });
            this._box.add_child(this._resBox);

            if (this._engine != 'Google') {
                let label = new St.Label({
                    style_class: 'tc-title-label',
                    track_hover: true,
                    reactive: true,
                });
                label.clutter_text.set_line_wrap(true);
                label.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
                label.clutter_text.set_markup(this._md2pango(result));
                label.connect('button-press-event', () => {
                    this._tts.playAudio(f);
                });
                this._resBox.add_child(label);
                return;
            }

            let json = JSON.parse(result);
            let t = '';
            let f = '';
            let t012 = json[0][1][2];
            let t013 = json[0][1][3];
            for (let k in json[0]) {
                let tk = json[0][k];
                if (tk[1])
                {
                    let tk1 = tk[1].replace(/\n/g, '');
                    if (k > 0)
                        f += '\n';
                    f += tk1;
                }
                if (tk[0])
                {
                    let tk0 = tk[0].replace(/\n/g, '');
                    if (k > 0)
                        t += '\n';
                    t += tk0;
                }
            }
            let l013 = new St.Label({text: f + (t013 ? ' /' + t013 + '/' : ''),
                                     style_class: 'tc-title-label',
                                     track_hover: true,
                                     reactive: true,
                                    });
            l013.clutter_text.set_line_wrap(true);
            l013.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
            l013.connect('button-press-event', () => {
                this._tts.playAudio(f);
            });

            let l012 = new St.Label({text: t + '\n(' + t012 + ')',
                                     style_class: 'tc-title-label',
                                     track_hover: true,
                                     reactive: true,
                                    });
            l012.clutter_text.set_line_wrap(true);
            l012.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
            l012.connect('button-press-event', () => {
                this._tts.playAudio(t);
            });

            let rtl1 = this._isRtl(json[2]);
            if (rtl1) {
                l013.add_style_pseudo_class('rtl');
            }
            let to = this._to.get_text();
            if (to == 'auto')
                to = this._locale;
            let rtl2 = this._isRtl(to);
            if (rtl2) {
                l012.add_style_pseudo_class('rtl');
            }

            let summary = new St.BoxLayout({vertical: true,
                                           track_hover: false,
                                           reactive: true,
                                           style_class: 'tc-section-box'
            });
            summary.add_child(l013);
            summary.add_child(l012);
            this._resBox.add_child(summary);

            if (this._briefMode)
                return;

            let t1 = json[1];
            if (t1) {
                for (let k in t1) {
                    let t1k = t1[k];
                    if (t1k)
                    {
                        //print('\n' + t1k[0]);
                        let t1k0 = new St.Label({text: t1k[0],
                                                style_class: 'tc-section-label'
                        });
                        this._resBox.add_child(t1k0);
                        let ttn = t1k[2];
                        for (let i in ttn) {
                            let ttni0 = ttn[i][0];
                            let ttni1 = '';
                            for (let j in ttn[i][1]) {
                                //print(ttn[i][1][j]);
                                if (j == 0)
                                    ttni1 += ttn[i][1][j];
                                else
                                    ttni1 += ', ' + ttn[i][1][j];
                            }
                            //print(ttni);
                            let ttniLabel = this._createLabelWidget(ttni0, ttni1, rtl2, rtl1);
                            this._resBox.add_child(ttniLabel);
                        }
                    }
                }
            }
        } catch (error) {
            log('Failed with error ' + error + ' @ '+error.lineNumber);
            log(error.stack);
            notify(IndicatorName, 'Failed with error ' + error);
        }
    }

    _translate(text) {
        this._translator.translate(this._from.text, this._to.text, this._proxy, text);
    }
});

export default class TranslateClipboardExtension extends Extension {
    enable() {
        tcIndicator = new TcIndicator(this);
        Main.panel.addToStatusArea(IndicatorName, tcIndicator);
    }
    disable() {
        tcIndicator.destroy();
        tcIndicator = null;
    }
}
