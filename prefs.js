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

        /* TODO */
        this._addKeybindingRow({label: _('Translate selected text'),
                                keys: Utils.Fields.TRANS_SELECTED
        });

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

    _addKeybindingRow(params){
        let key0 = this._settings.get_strv(params.keys)[0];
        let [ok, key, mods] = Gtk.accelerator_parse(key0);
        let accelString = ok ? Gtk.accelerator_name(key, mods) : "";
        let keys = new Gtk.Label({label: accelString,
                                  halign : Gtk.Align.END,
                                  valign : Gtk.Align.CENTER,
        });
        keys.get_style_context().add_class('dim-label');
        let row = new Adw.ActionRow({
            title: params.label,
            subtitle: _('Shortcut keys for translating selected text')
        });
        row.add_suffix(keys);
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
        this._schema = this._settings.settings_schema;
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

        // Model selection
        const modelRow = new Adw.EntryRow({
            title: _('Model'),
            tooltip_text: _('Model name/identifier for the LLM service'),
            text: ''
        });
        this._aiGroup.add(modelRow);
        this._modelRow = modelRow;

        // API Key
        const apiKeyRow = new Adw.PasswordEntryRow({
            title: _('API Key'),
            text: ''
        });
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
            this._settings.reset('llm-provider');
            this._settings.reset('provider-settings');
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
        this._modelRow.connect('changed', (row) => { this._writeSettings(); });
        this._apiKeyRow.connect('changed', (row) => { this._writeSettings(); });
        this._temperatureRow.connect('changed', (row) => { this._writeSettings(); });
        this._topPRow.connect('changed', (row) => { this._writeSettings(); });
        this._topKRow.connect('changed', (row) => { this._writeSettings(); });
        this._minPRow.connect('changed', (row) => { this._writeSettings(); });
        this._promptBuffer.connect('changed', () => { this._writeSettings(); });
    }

    _writeSettings() {
        const configs = Utils.readConfig(this._settings, 'provider-settings');
        let [start, end] = this._promptBuffer.get_bounds();
        let text = this._promptBuffer.get_text(start, end, false);
        const params = {
            model: this._modelRow.get_text(),
            apiKey: this._apiKeyRow.get_text(),
            temperature: this._temperatureRow.get_value(),
            topP: this._topPRow.get_value(),
            topK: this._topKRow.get_value(),
            minP: this._minPRow.get_value(),
            prompt: text,
        };
        configs[this._provider] = params;
        Utils.writeConfig(this._settings, 'provider-settings', configs);
    }

    _refresh() {
        const configs = Utils.readConfig(this._settings, 'provider-settings');
        const params = configs[this._provider] ?? {};
        const model = (params.model && params.model != '') ?
            params.model : Providers[this._provider].models[0];
        const temperature = params.temperature ?? Utils.defaultConfig.temperature;
        const apiKey = params.apiKey ?? Providers[this._provider].getApiKey();
        const topP = params.topP ?? Utils.defaultConfig.topP;
        const topK = params.topK ?? Utils.defaultConfig.topK;
        const minP = params.minP ?? Utils.defaultConfig.minP;
        const prompt = params.prompt ?? Utils.defaultConfig.prompt;

        this._modelRow.set_text(model);
        this._apiKeyRow.set_text(apiKey);
        this._temperatureRow.set_value(temperature);
        this._topPRow.set_value(topP);
        this._topKRow.set_value(topK);
        this._minPRow.set_value(minP);
        this._promptBuffer.set_text(prompt, -1);
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
