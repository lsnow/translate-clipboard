import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Clutter from 'gi://Clutter';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import { notify } from 'resource:///org/gnome/shell/ui/main.js';

const IndicatorName = 'Translate Clipboard';

export const TranslateWindow = GObject.registerClass(
    class TranslateWindow extends GObject.Object {
        _init(params) {
            super._init();
            
            this._extension = params.extension;
            this._tts = params.tts;
            this._engine = params.engine || 'google';
            this._briefMode = params.briefMode || false;
            this._dump = params.dump !== undefined ? params.dump : true;
            this._autoClose = params.autoClose !== undefined ? params.autoClose : true;
            this._autoHideMode = params.autoHideMode || 'timeout';
            this._locale = params.locale || 'en';
            this._fromEntry = params.fromEntry;
            this._toEntry = params.toEntry;
            this._translateCallback = params.translateCallback;
            this._isRtl = params.isRtl;
            
            this._actor = null;
            this._scroll = null;
            this._box = null;
            this._searchEntry = null;
            this._closeButton = null;
            this._label = null;
            this._resBox = null;
            this._loadingLabel = null;
            this._loadingAnimationId = 0;
            this._clickHandlerId = null;
            this._popupTimeoutId = 0;
            this._x = 0;
            this._y = 0;
        }

        destroy() {
            this._removeClickHandler();
            if (this._loadingAnimationId) {
                GLib.source_remove(this._loadingAnimationId);
                this._loadingAnimationId = 0;
            }
            if (this._actor) {
                this._actor.destroy();
                this._actor = null;
            }
            if (this._popupTimeoutId) {
                GLib.source_remove(this._popupTimeoutId);
                this._popupTimeoutId = 0;
            }
        }

        showLoading(x, y, text) {
            this._x = x;
            this._y = y;
            
            if (!this._actor) {
                this._createWindow();
            }
            
            if (text && this._searchEntry) {
                this._searchEntry.set_text(text);
            }
            
            let monitor = Main.layoutManager.currentMonitor;
            const { scale_factor: scaleFactor } = St.ThemeContext.get_for_stage(global.stage);
            
            let initialX = x;
            let initialY = y + 10;
            
            if (initialX + 150 > monitor.x + monitor.width) {
                initialX = monitor.x + monitor.width - 150;
            }
            if (initialY + 100 > monitor.y + monitor.height) {
                initialY = monitor.y + monitor.height - 100;
            }
            
            this._actor.set_position(initialX, initialY);
            this._actor.show();
            
            if (this._autoClose) {
                this._closeButton.hide();
                this._box.reactive = false;
            } else {
                this._closeButton.show();
                this._box.reactive = true;
            }
            
            if (this._popupTimeoutId) {
                GLib.source_remove(this._popupTimeoutId);
                this._popupTimeoutId = 0;
            }
            
            if (this._label) {
                this._label.destroy();
                this._label = null;
            }
            if (this._resBox) {
                this._resBox.destroy();
                this._resBox = null;
            }
            if (this._loadingLabel) {
                this._loadingLabel.destroy();
                this._loadingLabel = null;
            }
            
            this._loadingLabel = new St.Label({
                text: _("翻译中"),
                style_class: 'tc-loading-text',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER
            });
            this._loadingLabel.clutter_text.set_line_wrap(true);
            this._loadingLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
            this._box.add_child(this._loadingLabel);
            
            if (this._loadingAnimationId) {
                GLib.source_remove(this._loadingAnimationId);
                this._loadingAnimationId = 0;
            }
            
            let dotCount = 0;
            this._loadingAnimationId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                if (!this._loadingLabel || !this._loadingLabel.get_parent()) {
                    this._loadingAnimationId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                dotCount = (dotCount + 1) % 4;
                let dots = '.'.repeat(dotCount);
                this._loadingLabel.text = _("翻译中") + dots;
                return GLib.SOURCE_CONTINUE;
            });
            GLib.Source.set_name_by_id(this._loadingAnimationId, '[gnome-shell] TranslateWindow.loadingAnimation');
            
            this._scroll.set_style(
                'max-height: %spx; max-width: %spx;'.format(monitor.height / scaleFactor / 2,
                    monitor.width / scaleFactor / 2));
            
            this._updateHideBehavior();
        }

        showResult(result, x, y) {
            this._x = x;
            this._y = y;
            
            if (!this._actor) {
                this._createWindow();
            }
            
            if (this._autoClose) {
                this._closeButton.hide();
                this._box.reactive = false;
            } else {
                this._closeButton.show();
                this._box.reactive = true;
            }
            
            if (this._popupTimeoutId) {
                GLib.source_remove(this._popupTimeoutId);
                this._popupTimeoutId = 0;
            }
            
            if (this._label) {
                this._label.destroy();
                this._label = null;
            }
            if (this._resBox) {
                this._resBox.destroy();
                this._resBox = null;
            }
            if (this._loadingLabel) {
                this._loadingLabel.destroy();
                this._loadingLabel = null;
            }
            if (this._loadingAnimationId) {
                GLib.source_remove(this._loadingAnimationId);
                this._loadingAnimationId = 0;
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
                'max-height: %spx; max-width: %spx;'.format(monitor.height / scaleFactor / 2,
                    monitor.width / scaleFactor / 2));
            let natWidth = this._scroll.get_preferred_width(-1)[1];
            if (x + natWidth > monitor.x + monitor.width) {
                x = monitor.x + monitor.width - natWidth;
            }

            let natHeight = this._scroll.get_preferred_height(-1)[1];
            if (y + 10 + natHeight > monitor.y + monitor.height) {
                y = monitor.y + monitor.height - natHeight;
            }

            this._actor.set_position(x, y + 10);
            this._actor.show();
            this._updateHideBehavior();
        }

        updateSettings(params) {
            if (params.engine !== undefined) {
                this._engine = params.engine;
            }
            if (params.briefMode !== undefined) {
                this._briefMode = params.briefMode;
            }
            if (params.dump !== undefined) {
                this._dump = params.dump;
            }
            if (params.autoClose !== undefined) {
                this._autoClose = params.autoClose;
            }
            if (params.autoHideMode !== undefined) {
                this._autoHideMode = params.autoHideMode;
            }
            if (params.locale !== undefined) {
                this._locale = params.locale;
            }
            
            if (this._actor && this._actor.visible) {
                this._updateHideBehavior();
            }
        }

        _createWindow() {
            this._actor = new St.Widget();
            this._scroll = new St.ScrollView({
                style_class: "translate-scroll",
                hscrollbar_policy: St.PolicyType.AUTOMATIC,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
            });
            this._actor.add_child(this._scroll);
            this._box = new St.BoxLayout({
                style_class: "translate-box",
                vertical: true,
                x_expand: true,
                y_expand: true
            });
            this._scroll.add_child(this._box);

            let searchBox = new St.BoxLayout({
                style_class: 'tc-search-box'
            });
            this._searchEntry = new St.Entry({
                hint_text: _("输入要查询的文本..."),
                style_class: 'tc-search-entry'
            });
            
            // 设置左侧图标（翻译图标）
            let translateIcon = new St.Icon({
                gicon: Gio.icon_new_for_string(`${this._extension.path}/icons/translator-symbolic.svg`),
                style_class: 'popup-menu-icon',
            });
            this._searchEntry.set_primary_icon(translateIcon);
            
            // 设置右侧图标（搜索图标）
            let searchIcon = new St.Icon({
                gicon: Gio.icon_new_for_string(`${this._extension.path}/icons/search.svg`),
                style_class: 'popup-menu-icon',
            });
            this._searchEntry.set_secondary_icon(searchIcon);
            
            // 监听图标点击事件
            this._searchEntry.connect('primary-icon-clicked', () => {
                this._onSearchTranslate();
            });
            this._searchEntry.connect('secondary-icon-clicked', () => {
                this._onSearchTranslate();
            });
            
            // 监听回车键
            this._searchEntry.clutter_text.connect('activate', () => {
                this._onSearchTranslate();
            });
            
            searchBox.add_child(this._searchEntry);
            this._box.add_child(searchBox);

            let closeIcon = new St.Icon({
                icon_name: 'window-close-symbolic',
                icon_size: 24
            });
            this._closeButton = new St.Button({
                style_class: 'message-close-button',
                child: closeIcon,
            });
            this._actor.add_child(this._closeButton);
            this._closeButton.connect('clicked', () => {
                this._close();
            });

            this._closeButton.add_constraint(new Clutter.BindConstraint({
                source: this._box,
                coordinate: Clutter.BindCoordinate.POSITION,
            }));
            this._closeButton.add_constraint(
                new Clutter.AlignConstraint({
                    source: this._box,
                    align_axis: Clutter.AlignAxis.X_AXIS,
                    pivot_point: new Graphene.Point({ x: 0, y: -1 }),
                    factor: 0,
                }));

            Main.layoutManager.addChrome(this._actor, { affectsInputRegion: true });
        }

        _close() {
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
            if (this._loadingLabel) {
                this._loadingLabel.destroy();
                this._loadingLabel = null;
            }
            if (this._loadingAnimationId) {
                GLib.source_remove(this._loadingAnimationId);
                this._loadingAnimationId = 0;
            }
        }

        _updateHideBehavior() {
            this._removeClickHandler();
            this._updatePopupTimeout(0);

            if (this._autoClose) {
                if (this._autoHideMode === 'click' || this._autoHideMode === 'both') {
                    this._setupClickHandler();
                }
                if (this._autoHideMode === 'timeout' || this._autoHideMode === 'both') {
                    this._updatePopupTimeout(5000);
                }
            } else {
                if (this._autoHideMode === 'click' || this._autoHideMode === 'both') {
                    this._setupClickHandler();
                }
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
            if (this._loadingLabel) {
                this._loadingLabel.destroy();
                this._loadingLabel = null;
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
                GLib.Source.set_name_by_id(this._popupTimeoutId, '[gnome-shell] TranslateWindow._popupTimeout');
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

        _createLabelWidget(str1, str2, rtl1, rtl2) {
            let box = new St.BoxLayout({ vertical: rtl1 || rtl2 });
            let label1 = new St.Label({
                text: str1 + ' : ',
                style_class: 'tc-normal-label'
            });
            let label2 = new St.Label({
                text: str2,
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
        _md2pango(origin) {
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

        _parseResult(result) {
            if (this._resBox) {
                this._resBox.destroy();
                this._resBox = null;
            }
            try {
                this._resBox = new St.BoxLayout({
                    vertical: true,
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
                        this._tts.playAudio(result);
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
                    if (tk[1]) {
                        let tk1 = tk[1].replace(/\n/g, '');
                        if (k > 0)
                            f += '\n';
                        f += tk1;
                    }
                    if (tk[0]) {
                        let tk0 = tk[0].replace(/\n/g, '');
                        if (k > 0)
                            t += '\n';
                        t += tk0;
                    }
                }
                let l013 = new St.Label({
                    text: f + (t013 ? ' /' + t013 + '/' : ''),
                    style_class: 'tc-title-label',
                    track_hover: true,
                    reactive: true,
                });
                l013.clutter_text.set_line_wrap(true);
                l013.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
                l013.connect('button-press-event', () => {
                    this._tts.playAudio(f);
                });

                let l012 = new St.Label({
                    text: t + '\n(' + t012 + ')',
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
                let to = this._toEntry.get_text();
                if (to == 'auto')
                    to = this._locale;
                let rtl2 = this._isRtl(to);
                if (rtl2) {
                    l012.add_style_pseudo_class('rtl');
                }

                let summary = new St.BoxLayout({
                    vertical: true,
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
                        if (t1k) {
                            let t1k0 = new St.Label({
                                text: t1k[0],
                                style_class: 'tc-section-label'
                            });
                            this._resBox.add_child(t1k0);
                            let ttn = t1k[2];
                            for (let i in ttn) {
                                let ttni0 = ttn[i][0];
                                let ttni1 = '';
                                for (let j in ttn[i][1]) {
                                    if (j == 0)
                                        ttni1 += ttn[i][1][j];
                                    else
                                        ttni1 += ', ' + ttn[i][1][j];
                                }
                                let ttniLabel = this._createLabelWidget(ttni0, ttni1, rtl2, rtl1);
                                this._resBox.add_child(ttniLabel);
                            }
                        }
                    }
                }
            } catch (error) {
                log('Failed with error ' + error + ' @ ' + error.lineNumber);
                log(error.stack);
                notify(IndicatorName, 'Failed with error ' + error);
            }
        }

        _onSearchTranslate() {
            let text = this._searchEntry.text;
            if (text && text.trim() != '') {
                let trimmedText = text.trim();
                if (this._actor && this._actor.visible) {
                    let [x, y] = this._actor.get_position();
                    this._x = x;
                    this._y = y - 10;
                } else {
                    [this._x, this._y] = global.get_pointer();
                }
                this.showLoading(this._x, this._y, trimmedText);
                if (this._translateCallback) {
                    this._translateCallback(trimmedText);
                }
            }
        }
    });
