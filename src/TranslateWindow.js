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

            const fixedWidth = 400;
            const maxHeight = monitor.height / scaleFactor / 2;
            this._actor.set_width(fixedWidth);
            this._scroll.set_style('width: %spx; max-height: %spx;'.format(fixedWidth, maxHeight));

            if (initialX + fixedWidth > monitor.x + monitor.width) {
                initialX = monitor.x + monitor.width - fixedWidth;
            }

            this._actor.set_position(initialX, initialY);
            this._actor.show();

            if (this._autoClose) {
                this._closeButton?.hide();
                this._box.reactive = false;
            } else {
                this._closeButton?.show();
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
            this._loadingLabel.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);
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

            this._updateHideBehavior();
        }

        showResult(result, x, y) {
            this._x = x;
            this._y = y;

            if (!this._actor) {
                this._createWindow();
            }

            if (this._autoClose) {
                this._closeButton?.hide();
                this._box.reactive = false;
            } else {
                this._closeButton?.show();
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
                this._label.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);
                this._box.add_child(this._label);
                this._label.clutter_text.set_markup(result);
            } else {
                this._parseResult(result);
            }

            let monitor = Main.layoutManager.currentMonitor;
            const { scale_factor: scaleFactor } = St.ThemeContext.get_for_stage(global.stage);

            const fixedWidth = 400;
            const maxHeight = monitor.height / scaleFactor / 2;
            this._actor.set_width(fixedWidth);
            this._scroll.set_style('width: %spx; max-height: %spx;'.format(fixedWidth, maxHeight));

            if (x + fixedWidth > monitor.x + monitor.width) {
                x = monitor.x + monitor.width - fixedWidth;
            }

            let natHeight = this._scroll.get_preferred_height(-1)[1];
            if (y + 10 + natHeight > monitor.y + monitor.height) {
                y = monitor.y + monitor.height - natHeight - 10;
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
            this._actor = new St.Widget({
                style_class: 'translate-window'
            });
            this._scroll = new St.ScrollView({
                style_class: "translate-scroll",
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
            });

            let hideScrollbar = () => {
                if (!this._scroll) return;
                let children = this._scroll.get_children();
                for (let i = 0; i < children.length; i++) {
                    let child = children[i];
                    if (child instanceof St.ScrollBar) {
                        child.hide();
                        child.set_opacity(0);
                    }
                }
            };

            this._scroll.connect('notify::visible', () => {
                if (this._scroll.visible) {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        hideScrollbar();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            });

            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                hideScrollbar();
                return GLib.SOURCE_REMOVE;
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
                style_class: 'tc-search-entry',
                x_expand: true
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
            let box = new St.BoxLayout(
                {
                    style_class: 'tc-normal-label-box',
                    vertical: false,
                });
            // let baseline = '线';
            let label1 = new St.Label({
                text: str1 + ' : ',
                style_class: 'tc-normal-label',
                y_align: Clutter.ActorAlign.START,
            });
            // label1.clutter_text.set_use_markup(true);
            // label1.clutter_text.set_markup(`${str1+ ' : '}<span alpha="1">${baseline}</span>`);
            label1.clutter_text.set_line_wrap(true);
            label1.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
            label1.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);
            let label2 = new St.Label({
                text: str2,
                style_class: 'tc-normal-label',
                y_align: Clutter.ActorAlign.START,
            });
            // label2.clutter_text.set_use_markup(true);
            // label2.clutter_text.set_markup(`<span alpha="1">${baseline}</span>${str2}`);
            label2.clutter_text.set_line_wrap(true);
            label2.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
            label2.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);
            if (rtl1)
                label1.add_style_pseudo_class('rtl');
            if (rtl2)
                label2.add_style_pseudo_class('rtl');
            box.add_child(label1);
            box.add_child(label2);

            return box;
        }

        _createPlayButton(text) {
            let playIcon = new St.Icon({
                gicon: Gio.icon_new_for_string(`${this._extension.path}/icons/play.svg`),
                style_class: 'popup-menu-icon',
                icon_size: 20
            });
            let playButton = new St.Button({
                style_class: 'tc-play-button',
                child: playIcon,
                x_expand: false,
                y_expand: false,
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.CENTER,
            });
            playButton.set_width(28);
            playButton.set_height(28);
            playButton.connect('clicked', () => {
                this._tts.playAudio(text);
            });
            return playButton;
        }

        _createTextWithPlayButton(label, text) {
            let playButton = this._createPlayButton(text);
            let textBox = new St.BoxLayout({
                vertical: false,
                style_class: 'tc-text-with-play',
                x_expand: true
            });
            textBox.add_child(label);
            textBox.add_child(playButton);
            return textBox;
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

        /**
         * @param {*} result hello: [[["你好","hello",null,null,10],[null,null,"Nǐ hǎo","həˈlō"]],[["interjection",["你好!","喂!"],[["你好!",["Hello!","Hi!","Hallo!"],null,0.13323711],["喂!",["Hey!","Hello!"],null,0.020115795]],"Hello!",9]],"en",null,null,[["hello",null,[["你好",null,true,false,[10]],["您好",null,true,false,[10]],["嗨",null,true,false,[8]]],[[0,5]],"hello",0,0]],1,[],[["en"],null,[1],["en"]],null,null,null,[["exclamation",[["used as a greeting or to begin a phone conversation.","m_en_gbus0460730.012","hello there, Katie!"]],"hello",17],["noun",[["an utterance of “hello”; a greeting.","m_en_gbus0460730.025","she was getting polite nods and hellos from people"]],"hello",1],["verb",[["say or shout “hello”; greet someone.","m_en_gbus0460730.034","I pressed the phone button and helloed"]],"hello",2]],[[["<b>hello</b> there, Katie!",null,null,null,null,"m_en_gbus0460730.012"]]],null,null,null,null,[null,2]]
         * @returns 
         */
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
                    label.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);
                    label.clutter_text.set_markup(this._md2pango(result));
                    label.connect('button-press-event', () => {
                        this._tts.playAudio(result);
                    });
                    this._resBox.add_child(label);
                    return;
                }

                let json = JSON.parse(result);

                // json[0] 是翻译结果数组，包含多个翻译选项
                // json[0][0] 是翻译文本数组，如 ["你好","hello",null,null,10]
                // json[0][1] 是音标信息数组，如 [null,null,"Nǐ hǎo","həˈlō"]
                // json[0][1][2] 是拼音/音标，如 "Nǐ hǎo"
                // json[0][1][3] 是音标符号，如 "həˈlō"
                // json[1] 是词性、例句等详细信息
                // json[2] 是源语言代码，如 "en"

                let translatedText = '';  // 翻译后的文本
                let originalText = '';    // 原始文本
                let phoneticSymbol = json[0][1][2];  // 拼音/音标，如 "Nǐ hǎo"
                let phoneticNotation = json[0][1][3]; // 音标符号，如 "həˈlō"

                // 遍历翻译结果数组，提取原始文本和翻译文本
                for (let translationIndex in json[0]) {
                    let translationItem = json[0][translationIndex];
                    // translationItem[1] 是原始文本
                    if (translationItem[1]) {
                        let originalTextPart = translationItem[1].replace(/\n/g, '');
                        if (translationIndex > 0)
                            originalText += '\n';
                        originalText += originalTextPart;
                    }
                    // translationItem[0] 是翻译文本
                    if (translationItem[0]) {
                        let translatedTextPart = translationItem[0].replace(/\n/g, '');
                        if (translationIndex > 0)
                            translatedText += '\n';
                        translatedText += translatedTextPart;
                    }
                }

                // 创建原始文本标签（带音标）
                let originalTextLabel = new St.Label({
                    text: originalText + (phoneticNotation ? ' /' + phoneticNotation + '/' : ''),
                    style_class: 'tc-title-label',
                    track_hover: true,
                    reactive: false,
                    x_expand: false,
                });
                originalTextLabel.clutter_text.set_line_wrap(true);
                originalTextLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
                originalTextLabel.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);

                // 创建原始文本水平布局（包含播放按钮）
                let originalTextBox = this._createTextWithPlayButton(originalTextLabel, originalText);

                // 创建翻译文本标签（带拼音）
                let translatedTextLabel = new St.Label({
                    text: translatedText + '\n(' + phoneticSymbol + ')',
                    style_class: 'tc-title-label',
                    track_hover: true,
                    reactive: false,
                    x_expand: false,
                });
                translatedTextLabel.clutter_text.set_line_wrap(true);
                translatedTextLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
                translatedTextLabel.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);

                // 创建翻译文本水平布局（包含播放按钮）
                let translatedTextBox = this._createTextWithPlayButton(translatedTextLabel, translatedText);

                // 检查文本方向（RTL）
                let sourceLanguageCode = json[2];
                let isSourceRtl = this._isRtl(sourceLanguageCode);
                if (isSourceRtl) {
                    originalTextLabel.add_style_pseudo_class('rtl');
                }

                let targetLanguageCode = this._toEntry.get_text();
                if (targetLanguageCode == 'auto')
                    targetLanguageCode = this._locale;
                let isTargetRtl = this._isRtl(targetLanguageCode);
                if (isTargetRtl) {
                    translatedTextLabel.add_style_pseudo_class('rtl');
                }

                // 创建摘要区域（包含原始文本和翻译文本）
                let summaryBox = new St.BoxLayout({
                    vertical: true,
                    track_hover: false,
                    reactive: true,
                    style_class: 'tc-section-box'
                });
                summaryBox.add_child(originalTextBox);
                summaryBox.add_child(translatedTextBox);
                this._resBox.add_child(summaryBox);

                if (this._briefMode)
                    return;

                // 显示详细的词性、例句等信息
                let detailedInfo = json[1];
                if (detailedInfo) {
                    for (let partOfSpeechIndex in detailedInfo) {
                        let partOfSpeechData = detailedInfo[partOfSpeechIndex];
                        if (partOfSpeechData) {
                            // partOfSpeechData[0] 是词性，如 "interjection", "noun", "verb"
                            let partOfSpeechLabel = new St.Label({
                                text: partOfSpeechData[0],
                                style_class: 'tc-section-label'
                            });
                            partOfSpeechLabel.clutter_text.set_line_wrap(true);
                            partOfSpeechLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
                            partOfSpeechLabel.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);
                            this._resBox.add_child(partOfSpeechLabel);

                            // partOfSpeechData[2] 是例句数组
                            let exampleSentences = partOfSpeechData[2];
                            for (let exampleIndex in exampleSentences) {
                                let exampleSentence = exampleSentences[exampleIndex];
                                // exampleSentence[0] 是例句原文
                                let exampleOriginal = exampleSentence[0];
                                // exampleSentence[1] 是例句翻译数组
                                let exampleTranslations = exampleSentence[1];
                                let exampleTranslationsText = '';
                                for (let translationIndex in exampleTranslations) {
                                    if (translationIndex == 0)
                                        exampleTranslationsText += exampleTranslations[translationIndex];
                                    else
                                        exampleTranslationsText += ', ' + exampleTranslations[translationIndex];
                                }
                                let exampleLabel = this._createLabelWidget(exampleOriginal, exampleTranslationsText, isTargetRtl, isSourceRtl);
                                this._resBox.add_child(exampleLabel);
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
