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

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {TcIndicator} from './src/TcIndicator.js';

const GETTEXT_DOMAIN = 'translate-clipboard-extension';
const IndicatorName = 'Translate Clipboard';

let tcIndicator = null;

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
