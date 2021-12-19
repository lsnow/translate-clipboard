'use strict'

const GObject = imports.gi.GObject;
const Gio = imports.gi.Gio;
imports.gi.versions.Gtk = '4.0'
const Gtk = imports.gi.Gtk;
const Extension = imports.misc.extensionUtils.getCurrentExtension();

const Voices = Extension.imports.voices;

const Gettext = imports.gettext;
const _ = Gettext.domain('translate-clipboard').gettext;

const SCHEMA_NAME = 'org.gnome.shell.extensions.translate-clipboard';

var Fields = {
    ENABLE_TRANS: 'enable-trans',
    ENABLE_SELECTION: 'enable-selection',
    BRIEF_MODE: 'brief-mode',
    AUTO_CLOSE: 'auto-close',
    FROM: 'from',
    TO: 'to',
    TRANS_SELECTED: 'translate-selected-text',
    TTS_ENGINE: 'voice'
};

const getSchema = function () {
    let schemaDir = Extension.dir.get_child('schemas').get_path();
    let schemaSource = Gio.SettingsSchemaSource.new_from_directory(schemaDir, Gio.SettingsSchemaSource.get_default(), false);
    let schema = schemaSource.lookup(SCHEMA_NAME, false);

    return new Gio.Settings({ settings_schema: schema });
};

var SettingsSchema = getSchema();

function init() {
    let localeDir = Extension.dir.get_child('locale');
    if (localeDir.query_exists(null))
        Gettext.bindtextdomain('translate-clipboard', localeDir.get_path());
}

var TcPrefsWidget = new GObject.registerClass(class TcPrefsWidget extends Gtk.Stack {
    _init() {
        super._init();
        this.margin = 20;

        this._settings = SettingsSchema;

        let scroll = new Gtk.ScrolledWindow({valign: Gtk.Align.FILL,
                                             halign: Gtk.Align.FILL,
                                             vexpand: true,
                                             hexpand: true
        });
        scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
        this.add_child(scroll);

        let viewport = new Gtk.Viewport();
        scroll.set_child(viewport);

        this._listbox = new Gtk.ListBox();
        viewport.set_child(this._listbox);

        this._addSwitch({key : 'enable-trans',
                         label : _('Enable or disable translation'),
                         pos: 0});
        this._addSwitch({key : 'brief-mode',
                         label : _('Brief mode'),
                         pos: 1});
        this._addSwitch({key : 'auto-close',
                         label : _('Auto hide'),
                         pos: 2});

        /* TODO */
        this._addKeybindingRow({label: _('Translate selected text'),
                                keys: Fields.TRANS_SELECTED,
                                pos: 3
        });

        this._addVoicesRow();
    }
    _addSwitch(params){
        let row = new Gtk.ListBoxRow({
            height_request: 36,
            selectable: false,
            visible: true,
        });

        let grid = new Gtk.Grid({
            column_spacing: 12,
            margin_start: 20,
            margin_end: 20,
            margin_top: 8,
            margin_bottom: 8,
            visible: true,
        });
        row.set_child(grid);

        let lbl = new Gtk.Label({label: params.label, halign: Gtk.Align.START, valign: Gtk.Align.CENTER, hexpand: true});
        grid.attach(lbl, 0, 0, 1, 1);
        let sw = new Gtk.Switch({halign : Gtk.Align.END, valign : Gtk.Align.CENTER});
        grid.attach(sw, 1, 0, 1, 1);
        this._settings.bind(params.key, sw, 'active', Gio.SettingsBindFlags.DEFAULT);
        this._listbox.insert(row, params.pos);
    }
    _addKeybindingRow(params){
        let row = new Gtk.ListBoxRow({
            height_request: 36,
            selectable: false,
            activatable: true,
            visible: true,
        });

        let hbox = new Gtk.Box({
            spacing: 12,
            margin_start: 20,
            margin_end: 20,
            margin_top: 8,
            margin_bottom: 8,
            visible: true,
        });
        row.set_child(hbox);

        let lbl = new Gtk.Label({label: params.label,
                                 halign: Gtk.Align.START,
                                 valign: Gtk.Align.CENTER,
                                 hexpand: true
        });
        hbox.append(lbl);
        let key0 = this._settings.get_strv(params.keys)[0];
        let [ok, key, mods] = Gtk.accelerator_parse(key0);
        let accelString = ok ? Gtk.accelerator_name(key, mods) : "";
        let keys = new Gtk.Label({label: accelString,
                                  halign : Gtk.Align.END,
                                  valign : Gtk.Align.CENTER,
        });
        keys.get_style_context().add_class('dim-label');
        hbox.append(keys);
        this._listbox.insert(row, params.pos);

        this._listbox.connect('row-activated', (row, r) => {
        });
        /*
        SettingsSchema.set_strv(id, [accelString]);
        */
    }
    _addVoicesRow(){
        let row = new Gtk.ListBoxRow({
            height_request: 36,
            selectable: false,
            activatable: true,
            visible: true,
        });

        let hbox = new Gtk.Box({
            spacing: 12,
            margin_start: 20,
            margin_end: 20,
            margin_top: 8,
            margin_bottom: 8,
            visible: true,
        });
        row.set_child(hbox);

        let lbl = new Gtk.Label({label: _('TTS Voice'),
                                 halign: Gtk.Align.START,
                                 valign: Gtk.Align.CENTER,
                                 hexpand: true
        });
        hbox.append(lbl);
        let voice = new Gtk.Label({label: '',
                                  halign : Gtk.Align.END,
                                  valign : Gtk.Align.CENTER,
        });
        //this._settings.bind('voice', voice, 'label', Gio.SettingsBindFlags.DEFAULT);
        this._settings.connect('changed::voice', (settings, key) => {
            let voices = Voices.voices;
            for (let v in voices) {
                if (voices[v].Name == settings.get_string(key)) {
                    let friendName = this._getShortName(voices[v].FriendlyName);
                    voice.set_label(friendName);
                }
            }
        });
        let voices = Voices.voices;
        let voiceName = this._settings.get_string('voice');
        for (let v in voices) {
            if (voices[v].Name == voiceName) {
                let friendName = this._getShortName(voices[v].FriendlyName);
                voice.set_label(friendName);
                break;
            }
        }
        hbox.append(voice);
        this._listbox.insert(row, 4);

        this._listbox.connect('row-activated', (box, _row) => {
            if (row != _row) {
                return;
            }
            this._buildPopover(row);
            this._popover.popup();
        });
    }

    _getShortName(name){
        let shortName = name.replace('Microsoft ', '');
        shortName = shortName.replace(' Online', '');
        return shortName;
    }

    _buildPopover(row){
        if (this._popover)
            return;
        let scroll = new Gtk.ScrolledWindow({valign: Gtk.Align.FILL,
                                             halign: Gtk.Align.FILL,
                                             vexpand: true,
                                             hexpand: true,
                                             propagate_natural_height: true
        });
        scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);

        let popover = new Gtk.Popover();
        let listbox = new Gtk.ListBox();
        scroll.set_child(listbox);
        popover.set_child(scroll);
        popover.set_parent(row);
        this._popover = popover;

        let voices = Voices.voices;
        for (let v in voices) {
            let row = new Gtk.ListBoxRow({
                                         height_request: 24,
                                         selectable: true,
                                         activatable: true,
                                         visible: true,
            });
            let lbl = new Gtk.Label({label: this._getShortName(voices[v].FriendlyName),
                                    halign: Gtk.Align.START,
                                    valign: Gtk.Align.CENTER,
                                    hexpand: true
            });
            row._voice = voices[v].Name;
            row.set_child(lbl);
            listbox.insert(row, -1);
        }
        listbox.connect('row-activated', (box, row) => {
            print(row._voice);
            this._settings.set_string('voice', row._voice);
            popover.hide();
        });
    }
});

function buildPrefsWidget() {
    let w = new TcPrefsWidget();
    w.show();
    return w;
}
