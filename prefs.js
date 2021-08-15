'use strict'

const GObject = imports.gi.GObject;
const Gio = imports.gi.Gio;
imports.gi.versions.Gtk = '4.0'
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Extension = imports.misc.extensionUtils.getCurrentExtension();

const Gettext = imports.gettext;
const _ = Gettext.domain('translate-clipboard').gettext;

const SCHEMA_NAME = 'org.gnome.shell.extensions.translate-clipboard';

var Fields = {
    ENABLE_TRANS: 'enable-trans',
    ENABLE_SELECTION: 'enable-selection',
    BRIEF_MODE: 'brief-mode',
    FROM: 'from',
    TO: 'to',
    TRANS_SELECTED: 'translate-selected-text',
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

        /* TODO */
        this._addKeybindingRow({label: _('Translate selected text'),
                                keys: Fields.TRANS_SELECTED,
                                pos: 3
        });
        /*
        let row = new Gtk.ListBoxRow({
            height_request: 36,
            selectable: false,
            visible: true,
        });
        let command = "Change keybinding by edit schemas file:\n" +
            "<b>" + SCHEMA_NAME + '.gschemas.xml</b>';
        let lbl = new Gtk.Label({label: command,
                                halign: Gtk.Align.START,
                                valign: Gtk.Align.START,
                                hexpand: true,
                                wrap: true,
        });
        row.set_child(lbl);
        this._listbox.insert(row, 4);

        row = new Gtk.ListBoxRow({
            height_request: 36,
            selectable: false,
            visible: true,
        });
        let schemaDir = Extension.dir.get_child('schemas').get_path();
        command = 'And run:\n"<b>glib-compile-schemas ' + schemaDir + '</b>"';
        lbl = new Gtk.Label({label: command,
                            halign: Gtk.Align.START,
                            valign: Gtk.Align.START,
                            hexpand: true,
                            wrap: true,
                            use_markup: true,
        });
        row.set_child(lbl);
        this._listbox.insert(row, 5);
        */
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
});

function buildPrefsWidget() {
    let w = new TcPrefsWidget();
    w.show();
    return w;
}
