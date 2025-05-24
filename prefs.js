'use strict'

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {providers as Providers} from './llm.js';
import * as Voices from './voices.js';
import * as Utils from './utils.js';

class GeneralPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    _init(settings) {
        super._init({
            title: _('General'),
            icon_name: 'emblem-system-symbolic',
            name: 'GeneralPage'
        });
        this._settings = settings;

        this._miscGroup = new Adw.PreferencesGroup();
        this.add(this._miscGroup);

        this._addSwitch({key : 'enable-trans',
                        label : _('Enable or disable translation'),
                        description : _('Whether to automatically translate selected text')
        });
        this._addSwitch({key : 'brief-mode',
                        label : _('Brief mode'),
                        description: null,
        });
        this._addSwitch({key : 'auto-close',
                        label : _('Auto hide'),
                        description: null,
        });

        this._addKeybindingRow();

        this._addVoicesRow();
        this._addProxyRow();
        this._addEnginesRow();
    }
    _addSwitch(params){
        let sw = new Gtk.Switch({halign : Gtk.Align.END, valign : Gtk.Align.CENTER});
        let row = new Adw.ActionRow({
            title: params.label,
            activatable_widget: sw,
            subtitle: params.description
        });
        this._settings.bind(params.key, sw, 'active', Gio.SettingsBindFlags.DEFAULT);
        row.add_suffix(sw);
        this._miscGroup.add(row);
    }

    _editShortcut(key, row, shortcutLabel) {
        const dialog = new Adw.Dialog({
            title: 'Set Shortcut',
        });

        const toolbarView = new Adw.ToolbarView();
        const headerBar = new Adw.HeaderBar({
            show_start_title_buttons: false,
            show_end_title_buttons: false,
        });
        const cancelButton = new Gtk.Button({ label: _("Cancel") });
        headerBar.pack_start(cancelButton);

        const applyButton = new Gtk.Button({
            label: _("Apply"),
            css_classes: ['suggested-action'],
        });
        headerBar.pack_end(applyButton);
        applyButton.set_sensitive(false);

        const vbox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top:12,
            margin_bottom:12,
            margin_start:12,
            margin_end:12
        });
        vbox.append(new Gtk.Label({
            label: _("Press the desired shortcut keys.\nPress Esc to cancel, Backspace to clear current input."),
            halign: Gtk.Align.CENTER,
            justify: Gtk.Justification.CENTER,
            margin_bottom: 12,
            css_classes: ['dim-label'],
        }));

        const currentKey = this._settings.get_strv(key)[0];
        let currentKeyLabel = new Gtk.ShortcutLabel({
            accelerator: currentKey || '',
            disabled_text: _("Press a key..."),
            halign: Gtk.Align.CENTER,
        });
        vbox.append(currentKeyLabel);

        toolbarView.add_top_bar(headerBar);
        toolbarView.set_content(vbox);
        dialog.set_child(toolbarView);
        dialog.present(this.get_root());

        cancelButton.connect('clicked', () => {
            dialog.close();
        });

        applyButton.connect('clicked', () => {
            if (capturedAccel !== null)
                this._settings.set_strv(key, [capturedAccel]);
            this._shortcutLabel.set_label(capturedAccel || _('Disabled'));
            dialog.close();
        });

        let capturedAccel = null;
        const controller = new Gtk.EventControllerKey();
        dialog.add_controller(controller);
        controller.connect('key-pressed', (controller, keyval, keycode, state) => {
            if (keyval === Gdk.KEY_Control_L || keyval === Gdk.KEY_Control_R ||
                keyval === Gdk.KEY_Alt_L     || keyval === Gdk.KEY_Alt_R ||
                keyval === Gdk.KEY_Shift_L   || keyval === Gdk.KEY_Shift_R ||
                keyval === Gdk.KEY_Super_L   || keyval === Gdk.KEY_Super_R ||
                keyval === Gdk.KEY_Meta_L    || keyval === Gdk.KEY_Meta_R) {
                return Gdk.EVENT_PROPAGATE;
            }
            if (keyval === Gtk.KEY_Escape) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            if (keyval === Gdk.KEY_BackSpace) {
                capturedAccel = "";
                currentKeyLabel.set_accelerator("");
                currentKeyLabel.set_disabled_text(_("Cleared (Press Apply)"));
                applyButton.set_sensitive(true);
                return Gdk.EVENT_STOP;
            }
            if (Gtk.accelerator_valid(keyval, state)) {
                let accel = Gtk.accelerator_name(keyval, state);
                const lastGT = accel.lastIndexOf('>');
                let keyPart = accel.substring(lastGT + 1);
                if (keyPart.length === 1 && keyPart >= 'a' && keyPart <= 'z') {
                    keyPart = keyPart.toUpperCase();
                    accel = accel.substring(0, lastGT + 1) + keyPart;
                }
                capturedAccel = accel;
                currentKeyLabel.set_accelerator(accel);
                applyButton.set_sensitive(true);
                return Gdk.EVENT_STOP;
            }
            return Gdk.EVENT_PROPAGATE;
        });

        dialog.connect('close-attempt', () => {
            return false;
        });
    }

    _addKeybindingRow(){
        const current = this._settings.get_strv(Utils.Fields.TRANS_SELECTED)[0];
        const [ok, key, mods] = Gtk.accelerator_parse(current);
        const accelString = ok ? Gtk.accelerator_name(key, mods) : "";
        const shortcutLabel = new Gtk.Label({
            label: accelString,
            halign : Gtk.Align.END,
            valign : Gtk.Align.CENTER,
        });
        this._shortcutLabel = shortcutLabel;
        //shortcut.get_style_context().add_class('dim-label');
        const editButton = new Gtk.Button({
            icon_name: 'document-edit-symbolic',
            valign: Gtk.Align.CENTER
        });

        let row = new Adw.ActionRow({
            title: 'Translate the selected text',
            subtitle: _('Shortcut keys for translating selected text')
        });

        editButton.connect('clicked', () => {
            this._editShortcut(Utils.Fields.TRANS_SELECTED, row, shortcutLabel);
        });
        row.add_suffix(shortcutLabel);
        row.add_suffix(editButton);
        this._miscGroup.add(row);
    }

    _getShortName(name){
        let shortName = name.replace('Microsoft ', '');
        shortName = shortName.replace(' Online', '').replace('(Natural)', '');
        return shortName;
    }
    _addVoicesRow(){
        let row = new Adw.ComboRow({
            title: _('TTS Voice'),
            subtitle: _('Text-to-speech'),
        });
        row.add_css_class('voices-row');
        this._miscGroup.add(row);

        const voiceList  = new Gtk.StringList;
        Voices.voices.forEach((v) => {
            voiceList.append(this._getShortName(v.FriendlyName));
        });
       
        row.set_model(voiceList);
        this._onVoiceChanged(row);

        this._settings.connect('changed::voice', (settings, key) => {
            this._onVoiceChanged(row);
        });
        row.connect('notify::selected', () => {
            this._settings.set_string('voice', Voices.voices[row.get_selected()].Name);
        });
    }

    _onVoiceChanged(row){
        let index = Voices.voices.map(e => e.Name).indexOf(this._settings.get_string('voice'));
        if (index == -1)
            index = 0;
        row.set_selected(index);
    }

    _addProxyRow(){
        let proxy = new Gtk.Entry({text: '',
                                  placeholder_text: 'protocol://host:port',
                                  halign : Gtk.Align.END,
                                  valign : Gtk.Align.CENTER,
                                  width_chars: 25
        });

        let row = new Adw.ActionRow({
            title: _('Network proxy'),
        });
        row.add_suffix(proxy);
        this._miscGroup.add(row);
        this._settings.bind('proxy', proxy, 'text', Gio.SettingsBindFlags.DEFAULT);
    }

    _addEnginesRow(){
        let row = new Adw.ComboRow({
            title: _('Engine'),
            subtitle: _('Translation engine')
        });
        this._miscGroup.add(row);

        const engineList  = new Gtk.StringList;
        engineList.append("Google");
        engineList.append("LLM");
       
        row.set_model(engineList);
        this._onEngineChanged(row);

        this._settings.connect('changed::engine', (settings, key) => {
            this._onEngineChanged(row);
        });
        row.connect('notify::selected', () => {
            this._settings.set_string('engine', engineList.get_string(row.get_selected()));
        });
    }
    _onEngineChanged(row){
        let engine = this._settings.get_string('engine');
        this._engine = engine;
        row.set_selected(engine != 'Google');
    }
}

class AiPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    _init(settings) {
        super._init({
            title: _('LLM'),
            icon_name: '',
            name: 'LLM'
        });
        this._settings = settings;
        // Create widget for setting provider, model, apikey, temperature, TopP, TopK, MinP, prompt
        this._aiGroup = new Adw.PreferencesGroup();
        this.add(this._aiGroup);
        
        // Provider
        const providerList = new Gtk.StringList();
        Object.values(Providers).forEach(p => {
            providerList.append(p.name);
        });
        const providerRow = new Adw.ComboRow({
            title: _('Provider'),
            subtitle: _('LLM service provider')
        });
        providerRow.set_model(providerList);
        this._aiGroup.add(providerRow);

        const endpointRow = new Adw.EntryRow({
            title: _('Endpoint'),
            tooltip_text: _('Endpoint for the LLM service'),
            text: ''
        });
        this._resetEndpoint = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            css_classes: ['flat', 'circular'],
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Undo'),
        });
        endpointRow.add_suffix(this._resetEndpoint);
        this._aiGroup.add(endpointRow);
        this._endpointRow = endpointRow;

        // Model selection
        const modelRow = new Adw.EntryRow({
            title: _('Model'),
            tooltip_text: _('Model name/identifier for the LLM service'),
            text: ''
        });
        this._nextButton = new Gtk.Button({
            icon_name: 'view-refresh-symbolic',
            css_classes: ['flat', 'circular'],
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Next model'),
        });
        this._moreButton = new Gtk.Button({
            icon_name: 'view-more-horizontal-symbolic',
            css_classes: ['flat', 'circular'],
            valign: Gtk.Align.CENTER,
            tooltip_text: _('More models'),
        });
        modelRow.add_suffix(this._nextButton);
        modelRow.add_suffix(this._moreButton);
        this._aiGroup.add(modelRow);
        this._modelRow = modelRow;

        // API Key
        const apiKeyRow = new Adw.PasswordEntryRow({
            title: _('API Key'),
            text: ''
        });
        this._signupButton = new Gtk.LinkButton({
            css_classes: ['flat'],
            valign: Gtk.Align.CENTER,
            uri: '',
            label: 'New',
            tooltip_text: _('Signup'),
        });
        apiKeyRow.add_suffix(this._signupButton);
        this._aiGroup.add(apiKeyRow);
        this._apiKeyRow = apiKeyRow;

        // Temperature
        const temperature = new Adw.SpinRow({
            title: _('Temperature'),
            digits: 2,
            adjustment: new Gtk.Adjustment({
                value: 0.70,
                lower: 0.0,
                upper: 2.0,
                step_increment: 0.01
            })
        });
        this._aiGroup.add(temperature);
        this._temperatureRow = temperature;

        // TopP
        const topP = new Adw.SpinRow({
            title: _('TopP'),
            digits: 2,
            adjustment: new Gtk.Adjustment({
                value: 0.90,
                lower: 0.0,
                upper: 2.0,
                step_increment: 0.01
            })
        });
        this._aiGroup.add(topP);
        this._topPRow = topP;

        // TopK
        const topK = new Adw.SpinRow({
            title: _('TopK'),
            adjustment: new Gtk.Adjustment({
                value: 20,
                lower: 0,
                upper: 50,
                step_increment: 1
            })
        });
        this._aiGroup.add(topK);
        this._topKRow = topK;

        // MinP
        const minP = new Adw.SpinRow({
            title: _('MinP'),
            digits: 2,
            adjustment: new Gtk.Adjustment({
                value: 0.0,
                lower: 0.0,
                upper: 2.0,
                step_increment: 0.01
            })
        });
        this._aiGroup.add(minP);
        this._minPRow = minP;

        this._extraGroup = new Adw.PreferencesGroup({
            title: _('Prompt template'),
        });
        this.add(this._extraGroup);

        // Prompt.
        const promptScrolled = new Gtk.ScrolledWindow({
            height_request: 100,
            hexpand: false,
        });
        const promptRow = new Adw.PreferencesRow({});
        const promptView = new Gtk.TextView({
            wrap_mode: Gtk.WrapMode.WORD,
        });
        const promptBuffer = promptView.get_buffer();
        promptBuffer.set_text('', -1);
        promptScrolled.set_child(promptView);
        promptRow.set_child(promptScrolled);
        this._extraGroup.add(promptRow);
        this._promptBuffer = promptBuffer;

        // Reset
        const resetButton = new Gtk.Button({
            label: _('Reset All Settings'),
            halign: Gtk.Align.CENTER,
            margin_top: 12,
            margin_bottom: 12
        });
        resetButton.get_style_context().add_class('destructive-action');

        resetButton.connect('clicked', () => {
            const schema = this._settings.schema_id;
            Utils.removeApiKey(schema, this._provider, () => {
                this._apiKeyRow.set_text('');
                const currentProvider = this._provider;
                this._settings.reset('llm-provider');
                this._settings.reset('provider-settings');
                if (currentProvider == this._provider)
                    this._refresh();
            });
        });
        const resetGroup = new Adw.PreferencesGroup({
            header_suffix: resetButton
        });
        this.add(resetGroup);

        this._onProviderChanged(providerRow);
        this._settings.connect('changed::llm-provider', (settings, key) => {
            this._onProviderChanged(providerRow);
        });
        providerRow.connect('notify::selected', () => {
            this._settings.set_string('llm-provider',
                Object.values(Providers)[providerRow.get_selected()].name);
        });
        this._bindSettings();
    }

    _onProviderChanged(row) {
        const provider = this._settings.get_string('llm-provider');
        let index = 0;
        for (const p in Providers) {
            if (Providers[p].name == provider) {
                row.set_selected(index);
                this._provider = p;
                this._refresh();
                break;
            }
            index++;
        }
    }

    _bindSettings() {
        this._endpointRow.connect('changed', (row) => { this._writeSettings(); });
        this._modelRow.connect('changed', (row) => { this._writeSettings(); });
        this._apiKeyRow.connect('changed', (row) => {
            if (this._isReadFromSecret) {
                this._isReadFromSecret = false;
                return;
            }
            const apiKey = this._apiKeyRow.get_text();
            const schema = this._settings.schema_id;
            Utils.removeApiKey(schema, this._provider, () => {
                Utils.storeApiKey(schema, this._provider, apiKey);
            });
        });
        this._temperatureRow.connect('changed', (row) => { this._writeSettings(); });
        this._topPRow.connect('changed', (row) => { this._writeSettings(); });
        this._topKRow.connect('changed', (row) => { this._writeSettings(); });
        this._minPRow.connect('changed', (row) => { this._writeSettings(); });
        this._promptBuffer.connect('changed', () => { this._writeSettings(); });

        this._resetEndpoint.connect('clicked', () => {
            const endpoint = Providers[this._provider].endpoint;
            this._endpointRow.set_text(endpoint);
        });

        this._nextButton.connect('clicked', () => {
            const models = Providers[this._provider].models;
            const model = this._modelRow.get_text();
            const current = models.indexOf(model);
            const next = current !== -1 && current < models.length - 1
                ? current + 1
                : 0;
            this._modelRow.set_text(models[next] || model);
        });

        this._moreButton.connect('clicked', () => {
            const modelsUri = Providers[this._provider].modelsUri;
            const launcher = new Gtk.UriLauncher({ uri: modelsUri ?? '' });
            launcher.launch(null, null, null, null);
        });
    }

    _writeSettings() {
        const configs = Utils.readConfig(this._settings, 'provider-settings');
        let [start, end] = this._promptBuffer.get_bounds();
        let text = this._promptBuffer.get_text(start, end, false);
        const params = {
            endpoint: this._endpointRow.get_text(),
            model: this._modelRow.get_text(),
            temperature: this._temperatureRow.get_value(),
            topP: this._topPRow.get_value(),
            topK: this._topKRow.get_value(),
            minP: this._minPRow.get_value(),
            prompt: text,
        };
        configs[this._provider] = params;
        // For compatibility with previous versions
        for (const [provider, config] of Object.entries(configs)) {
            if (!config.endpoint)
                config.endpoint = Providers[provider].endpoint;
        }
        Utils.writeConfig(this._settings, 'provider-settings', configs);
    }

    _refresh() {
        const configs = Utils.readConfig(this._settings, 'provider-settings');
        const params = configs[this._provider] ?? {};
        const endpoint = params.endpoint || Providers[this._provider].endpoint;
        const model = params.model || Providers[this._provider].models[0] || '';
        const temperature = params.temperature ?? Utils.defaultConfig.temperature;
        const topP = params.topP ?? Utils.defaultConfig.topP;
        const topK = params.topK ?? Utils.defaultConfig.topK;
        const minP = params.minP ?? Utils.defaultConfig.minP;
        const prompt = params.prompt ?? Utils.defaultConfig.prompt;

        const schema = this._settings.schema_id;
        Utils.getApiKey(schema, this._provider,
            (apiKey) => {
                this._isReadFromSecret = !!apiKey;
                this._apiKeyRow.set_text(apiKey || Providers[this._provider].getApiKey() || '');
            },
            (error) => {
                log(error);
            }
        );

        this._endpointRow.set_text(endpoint);
        this._modelRow.set_text(model);
        this._temperatureRow.set_value(temperature);
        this._topPRow.set_value(topP);
        this._topKRow.set_value(topK);
        this._minPRow.set_value(minP);
        this._promptBuffer.set_text(prompt, -1);

        const signupUri = Providers[this._provider].signup;
        if (signupUri) {
            this._signupButton.set_uri(signupUri);
            this._signupButton.set_sensitive(true);
        } else {
            this._signupButton.set_sensitive(false);
            this._signupButton.set_uri('');
        }
    }
}

export default class TranslateClipboardExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        let provider = new Gtk.CssProvider();
        provider.load_from_path(this.dir.get_path() + '/prefs.css');
        Gtk.StyleContext.add_provider_for_display(
                                                  Gdk.Display.get_default(),
                                                  provider,
                                                  Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        const settings = this.getSettings();
        const generalPage = new GeneralPage(settings);
        const aiPage = new AiPage(settings);

        window.add(generalPage);
        window.add(aiPage);
    }
}
