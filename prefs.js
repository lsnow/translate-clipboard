'use strict'

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import * as Voices from './voices.js';
import * as Utils from './utils.js';

class TranslatePrefsWidget extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    constructor(settings, dir) {
        super();
        this._settings = settings;

        let provider = new Gtk.CssProvider();
        provider.load_from_path(dir + '/prefs.css');
        Gtk.StyleContext.add_provider_for_display(
                                                  Gdk.Display.get_default(),
                                                  provider,
                                                  Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

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
        /*
        SettingsSchema.set_strv(id, [accelString]);
        */
    }
    _addVoicesRow(){
        let voice = new Gtk.Label({label: '',
                                  halign : Gtk.Align.END,
                                  valign : Gtk.Align.CENTER,
        });
        let row = new Adw.ComboRow({
            title: _('TTS Voice'),
            subtitle: _('Text-to-speech')
        });
        row.add_suffix(voice);
        this._miscGroup.add(row);

        const voiceList  = new Gtk.StringList;
        Voices.voices.forEach((v) => {
            voiceList.append(this._getShortName(v.FriendlyName));
        });
       
        row.set_model(voiceList);
        let idx = Voices.voices.map(e => e.Name).indexOf(this._settings.get_string('voice'));
        if (idx == -1)
            idx = 0;
        row.set_selected(idx);

        this._settings.connect('changed::voice', (settings, key) => {
            let idx = Voices.voices.map(e => e.Name).indexOf(this._settings.get_string('voice'));
            if (idx == -1)
                idx = 0;
            row.set_selected(idx);
        });
        row.connect('notify::selected', () => {
            this._settings.set_string('voice', Voices.voices[row.get_selected()].Name);
        });
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

    _getShortName(name){
        let shortName = name.replace('Microsoft ', '');
        shortName = shortName.replace(' Online', '').replace('(Natural)', '');
        return shortName;
    }
}

export default class TranslateClipboardExtensionPreferences extends ExtensionPreferences {
    getPreferencesWidget() {
        return new TranslatePrefsWidget(this.getSettings(), this.dir.get_path());
    }
}
