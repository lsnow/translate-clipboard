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

var TcPrefsWidget = new GObject.registerClass(class TcPrefsWidget extends Gtk.ListBox {
    _init() {
        super._init();
        this.margin = 20;

        this._settings = SettingsSchema;
        this._addSwitch({key : 'enable-trans',
                         label : _('Enable or disable translation'),
                         pos: 0});
        this._addSwitch({key : 'brief-mode',
                         label : _('Brief mode'),
                         pos: 1});
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
        this.insert(row, params.pos);
    }
});

function buildPrefsWidget() {
    let w = new TcPrefsWidget();
    w.show();
    return w;
}
