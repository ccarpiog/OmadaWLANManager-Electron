# Omada WLAN Manager — user guide

Omada WLAN Manager moves TP-Link Omada access points between AP groups. On Omada Controller 6.3
or later, optional **management access** also lets it create, rename and delete AP groups and
create, edit, enable, disable and delete Wi-Fi networks, and choose which AP groups broadcast each
network.

The app's interface is in Spanish or English (choose it in Settings). This guide is in English and
gives every interface term in both languages: in the table below, and in the text as bold
English / Spanish pairs, such as **Settings** / **Ajustes**.

## UI terms

| English UI | Spanish UI |
|---|---|
| Access points | Puntos de acceso |
| AP groups | Grupos de AP |
| WLAN groups (legacy) | Grupos WLAN (heredado) |
| Wi-Fi networks | Redes Wi-Fi |
| Settings | Ajustes |
| Configure connection | Configurar la conexión |
| Connect | Conectar |
| Disconnect | Desconectar |
| Refresh | Actualizar |
| Retry | Reintentar |
| Move selected APs | Mover los AP seleccionados |
| Silence | Silenciar |
| No Wi-Fi networks — silences these APs | Sin redes Wi-Fi — silencia estos AP |
| Move AP | Mover AP |
| Move 4 APs | Mover 4 AP |
| Review the move | Revisar el movimiento |
| Retry failed | Reintentar los fallidos |
| Management access (optional) | Acceso de gestión (opcional) |
| Test management access | Probar el acceso de gestión |
| New group | Nuevo grupo |
| Rename | Cambiar nombre |
| Delete | Eliminar |
| Move access points here | Mover puntos de acceso aquí |
| Per-band capacity | Capacidad por banda |
| Capacity warning | Aviso de capacidad |
| Default | Predeterminado |
| New network | Nueva red |
| Edit | Editar |
| Change password | Cambiar contraseña |
| Enable | Activar |
| Disable | Desactivar |
| Broadcast on | Se emite en |
| Change AP groups | Cambiar grupos de AP |
| All access points | Todos los puntos de acceso |
| Unknown scope | Alcance desconocido |
| Trust and connect | Confiar y conectar |
| Reset trusted certificate | Restablecer certificado de confianza |

## 1. Connecting

1. Open **Settings** / **Ajustes** (the gear at the bottom of the sidebar), or click
   **Configure connection** / **Configurar la conexión** on the first launch.
2. Fill in **Controller URL** / **URL del controlador** (for example `https://192.168.1.1:8043`),
   **Username** / **Usuario** and **Password** / **Contraseña**, pick the **Language** / **Idioma**,
   and click **Save** / **Guardar**. Nothing is saved before that.
3. Click **Connect** / **Conectar** in the header. The first time, the app asks you to confirm the
   controller's certificate (see [Certificate trust](#8-certificate-trust)). If the controller has
   several sites, choose one in **Select site** / **Seleccionar sitio**.
4. The header shows the site, the controller, the connection state, the time of the last load
   (**Updated 10:42** / **Actualizado 10:42**) and the Omada version. **Refresh** / **Actualizar**
   reloads everything and keeps the current data on screen meanwhile. If a refresh fails, the old
   data stays with the notice **Couldn't refresh the data. Showing the data from 10:42.** /
   **No se pudieron actualizar los datos. Se muestran los de las 10:42.** and a
   **Retry** / **Reintentar** button.

Credentials belong to one controller URL: saving a different URL drops the stored password, the
management credentials, the chosen site and the trusted certificate, and asks for the new
controller's password.

## 2. The three views

The sidebar switches between three views; each count is a total, not a filtered count:

- **Access points** / **Puntos de acceso** — the landing view: select access points and move them.
- **AP groups** / **Grupos de AP** (on controllers older than 6.3: **WLAN groups (legacy)** /
  **Grupos WLAN (heredado)**) — each group with its access points and Wi-Fi networks, including
  groups without any network.
- **Wi-Fi networks** / **Redes Wi-Fi** — each network with the groups and access points that
  broadcast it.

Every view has its own search. Clicking a group, network or access point name anywhere opens it in
its own view; **Back to …** / **Volver a …** returns to where you were. Without management access
the AP groups and Wi-Fi networks views are read-only, and a banner says why (section 4).

The window adapts to its width (minimum 700×500): from 1000 px the sidebar shows labels, from
800 px only icons and counts, and below 800 px a bar at the top switches views and each view shows
one pane at a time, with **←** back to the list.

## 3. Selecting and moving access points

- Tick the checkbox of each access point to move. Shift-click or Shift+arrow keys select a range;
  **Select all 12 filtered APs** / **Seleccionar los 12 AP filtrados** ticks every access point the
  search and filters show, and **Clear selection** / **Borrar selección** unticks all. A selection
  survives searching and filtering: the summary under the list says, for example,
  **2 hidden by filters** / **2 ocultos por los filtros**.
- Pick the destination in **Move selected APs** / **Mover los AP seleccionados**, next to the list
  (below 800 px, **Choose destination** / **Elegir destino** opens it). Its search
  (**Search groups or networks…** / **Buscar grupos o redes…**) matches group names and network
  names. Groups without networks are listed under **Silence** / **Silenciar** with the label
  **No Wi-Fi networks — silences these APs** / **Sin redes Wi-Fi — silencia estos AP**: moving an
  access point there stops it broadcasting.
- The pane previews the networks the selected access points gain, lose and keep (**Gains** /
  **Gana**, **Loses** / **Pierde**, **Unchanged** / **Sin cambios**) and how many are already in the
  destination (they are skipped). Access points report only their group's name, so a group whose
  name another group shares cannot be picked:
  **Another group has the same name — rename one in Omada to move APs here** /
  **Otro grupo tiene el mismo nombre — cambia el nombre de uno en Omada para mover AP aquí**.
- Click **Move AP** / **Mover AP** (or **Move 4 APs** / **Mover 4 AP**). **Review the move** /
  **Revisar el movimiento** lists the source groups, the destination, the network changes and the
  clients connected to the moving access points. It opens on **Cancel** / **Cancelar**; press the
  move button to confirm.
- Access points move one at a time; the move is not atomic. **Move results** /
  **Resultado del movimiento** lists each one as **Moved** / **Movido** or **Failed** / **Error**
  with the controller's message. Failed access points stay selected, and **Retry failed** /
  **Reintentar los fallidos** moves only those, through the same review.
- Click an access point's row (not its checkbox), or press Enter on its checkbox, to open
  **AP details** / **Detalles del AP**: status, MAC, group, clients and its group's networks.
  Per-AP network overrides set in Omada are not shown. **Close details** / **Cerrar detalles**
  brings the move pane back.

Moving access points never needs management access; it works on every controller version.

## 4. Management access (optional)

Management access uses the controller's Open API. It needs Omada Controller 6.3 or later and an
Open API application:

1. In the Omada web interface, open *Global View → Settings → Platform Integration → Open API* and
   add an application in **client credentials** mode with access to the site you manage. Copy its
   Client ID and Client Secret.
2. In the app, open **Settings** / **Ajustes**, section **Management access (optional)** /
   **Acceso de gestión (opcional)**. Fill in **Client ID** / **Client ID** and **Client Secret** /
   **Client Secret** and click **Save** / **Guardar**. The secret is stored encrypted and never
   shown again: the field then reads **(unchanged)** / **(sin cambios)**, and leaving it blank keeps
   it. When the computer cannot store it securely, Settings says it is kept only until you quit.
3. While connected, click **Test management access** / **Probar el acceso de gestión** (save first:
   the test uses the saved settings). It checks, in order, the controller version, the credentials,
   an access token, that the Open API sees the connected site, and that it reports exactly the same
   AP groups (by id) as the controller. Success reads **Management access works: every check passed.** /
   **El acceso de gestión funciona: se superaron todas las comprobaciones.**; otherwise the line names
   the failed check, with technical codes in parentheses.
4. **Remove management access** / **Quitar el acceso de gestión** deletes both values when you save;
   **Keep management access** / **Mantener el acceso de gestión** undoes it before saving.

**Read-only banner.** Without working management access, the AP groups and Wi-Fi networks views show
a banner with the reason and the fix, for example
**Open API credentials are not configured — viewing is available. Add them in Settings → Management access.** /
**No hay credenciales de Open API configuradas — puedes consultar los datos. Añádelas en Ajustes → Acceso de gestión.**
The possible reasons:

| Reason | What to do |
|---|---|
| The controller is older than 6.3 (legacy) | Nothing: moving access points works; editing needs 6.3 or later. |
| No Client ID / Client Secret saved | Add them in Settings. |
| The check is still running (also during a new test) | Wait: **Checking management access — viewing is available meanwhile.** / **Comprobando el acceso de gestión — mientras tanto puedes consultar los datos.** |
| The controller rejected the Client ID or Client Secret | Check both values in Settings. |
| No access token | Check that the Open API is enabled; run the test for details. |
| The Open API application cannot see this site | Give the application access to the site in Omada. |
| The Open API shows different AP groups than the controller | Management stays off for safety; report it (see the live-test checklist). |
| The Open API did not answer the checks | Run the test again; check the controller. |

Management actions appear only once every check passes. While a check runs, they are hidden.

## 5. AP groups

The list shows each group's access-point count and network count, the **Default** /
**Predeterminado** badge for the controller's default group, the label **No Wi-Fi networks —
silences these APs** / **Sin redes Wi-Fi — silencia estos AP** for groups without networks, and,
with management access, **Capacity warning** / **Aviso de capacidad** when the controller reports
a band of the group full (its tooltip names the band). A group's details list its access points
and its networks (as links; networks are bound to groups in the Wi-Fi networks view, section 7).

With management access, the details also show **Per-band capacity** / **Capacidad por banda**: how
many more networks the group can broadcast on 2.4 GHz, 5 GHz, 6 GHz and MLO, such as
**3 of 8 free** / **3 libres de 8**, or **Not reported** / **No informado** when the controller
does not say. The app never guesses a value.

Actions (management access only):

- **New group** / **Nuevo grupo** opens **New AP group** / **Nuevo grupo de AP**: type the
  **Group name** / **Nombre del grupo** and click **Create group** / **Crear grupo**. The group is
  created empty; move access points into it afterwards. A name has 1 to 128 characters, differs
  from every other group's name (ignoring case) and has no control characters.
- **Rename** / **Cambiar nombre** opens **Rename the group** / **Cambiar el nombre del grupo**. Its
  access points and networks stay as they are.
- **Delete** / **Eliminar** opens **Delete the group** / **Eliminar el grupo**; confirm with
  **Delete group** / **Eliminar grupo**. It cannot be undone. The default group has no Delete. For
  other groups the button is disabled, with the reason under it, until the group can go:
  - **To delete it, first move its access points to another group.** /
    **Para eliminarlo, mueve antes sus puntos de acceso a otro grupo.**
  - **To delete it, first unlink its Wi-Fi networks.** /
    **Para eliminarlo, desvincula antes sus redes Wi-Fi.**
  - **It cannot be deleted: the controller does not clearly report its access points or networks.** /
    **No se puede eliminar: el controlador no informa con claridad de sus puntos de acceso o de sus redes.**
  - **Checking whether it can be deleted…** / **Comprobando si se puede eliminar…**
- A group whose id the app does not recognize gets a note instead of the buttons:
  **This group's id has an unexpected format, so the app cannot rename or delete it.** /
  **El identificador de este grupo tiene un formato inesperado: la aplicación no puede cambiarle el nombre ni eliminarlo.**
- **Move access points here** / **Mover puntos de acceso aquí** (always available) opens
  Access points with this group already picked as the destination; tick the access points and move
  them as in section 3.

Before every change the app reads the controller's current groups again and refuses (with the
reason) when they contradict what you saw, for example when another group took the name meanwhile.

## 6. Wi-Fi networks

Without management access, the view lists the network names from the controller's group data, with
the groups and access points that broadcast each one; **Security, bands and whether the network is
enabled are not shown: they need management access.** / **No se muestran la seguridad, las bandas ni
si la red está activada: requieren acceso de gestión.**

With management access, each network shows its state (**Enabled** / **Activada** or **Disabled** /
**Desactivada**), its security (**Open** / **Abierta**, **WPA-Personal** / **WPA-Personal**,
**WPA-Enterprise** / **WPA-Enterprise**, **PPSK without RADIUS** / **PPSK sin RADIUS**,
**PPSK with RADIUS** / **PPSK con RADIUS**), its bands and its scope: **All access points** /
**Todos los puntos de acceso**, a count such as "2 groups · 7 APs", or **Unknown scope** /
**Alcance desconocido** when the controller does not say clearly. A network's details add whether a
password is set (**Set** / **Configurada**), never the password itself. If the list cannot be read
completely, the view shows why with **Retry** / **Reintentar** instead of a partial list.

Actions (management access only; each one asks for confirmation and names the scope it affects):

- **New network** / **Nueva red** opens **New Wi-Fi network** / **Nueva red Wi-Fi**: the
  **Network name (SSID)** / **Nombre de la red (SSID)** (1 to 32 bytes; accented letters and emoji
  take more than one), the **Security** / **Seguridad** (Open or WPA-Personal), the **Bands** /
  **Bandas**, for WPA-Personal the **Network password** / **Contraseña de la red** and
  **Type the password again** / **Repite la contraseña** (8 to 63 printable ASCII characters, used
  exactly as typed), at least one of the **AP groups that broadcast it** / **Grupos de AP que la
  emiten**, and **Enable after creating** / **Activar después de crearla** (off by default). Click
  **Create network** / **Crear red**. The network is created disabled unless that box is ticked. An
  open network cannot be created with 6 GHz: create it without, then add 6 GHz with Edit.
- **Edit** / **Editar** changes the name, Open ↔ WPA-Personal and the bands. Nothing is sent until
  **Review changes** / **Revisar los cambios** shows the differences and you click
  **Save changes** / **Guardar cambios** (or **Back** / **Atrás** to keep editing). Saving a
  WPA-Personal network always asks for its password again, because the app never reads the current
  one from the controller. A band or security change can lower the network's PMF setting from
  "Mandatory" to "Capable"; the review warns about it.
- **Change password** / **Cambiar contraseña**: type the new password twice, then confirm in
  **Confirm the password change** / **Confirmar el cambio de contraseña**. Devices must use the new
  password to join again.
- **Enable** / **Activar** and **Disable** / **Desactivar** start or stop broadcasting the network
  on its whole scope (confirm with **Enable network** / **Activar red** or **Disable network** /
  **Desactivar red**). Disabling disconnects its clients.
- **Delete** / **Eliminar** opens **Delete the network** / **Eliminar la red**, which lists the AP
  groups that will stop broadcasting it; **Delete network** / **Eliminar red** cannot be undone.

**WPA-Enterprise and PPSK networks** can be viewed, enabled, disabled, deleted and bound to AP
groups, but not edited and without Change password; their details explain why. Use the Omada web
interface for their settings. Nor can a network whose security the controller does not report
clearly be edited here.

The actions wait for fresh data: while the data on screen is stale (its last refresh failed) or the
network list is being read again, they are disabled with the reason. The app reads the network again
right before the Change password, Enable, Disable and Delete confirmations, and an edit is merged into
the controller's current settings when you save it.

## 7. Broadcast on

A managed network's details have a **Broadcast on** / **Se emite en** section with the AP groups
that broadcast it. This is the only place where the app changes which groups broadcast a network.

1. Click **Change AP groups** / **Cambiar grupos de AP**. Tick and untick groups; the search
   (**Search AP groups…** / **Buscar grupos de AP…**) filters the list, and a preview shows how
   many groups and access points will broadcast the network.
2. Click **Review the change** / **Revisar el cambio**. The app first reads the current data again
   (**Reading the current data again…** / **Leyendo de nuevo los datos actuales…**), then lists the
   groups **Now** / **Ahora** and **After** / **Después**, and which are **Added** / **Se añaden**,
   **Removed** / **Se quitan** and **Kept** / **Se mantienen**.
3. Groups without room for the network on one of its bands are listed under
   **No confirmed room for this network:** / **Sin hueco confirmado para esta red:** with the band;
   the app never assumes there is room, so it does not save such a change.
4. Click **Save AP groups** / **Guardar grupos de AP**. The access points of removed groups stop
   broadcasting the network and their clients on it are disconnected.

Rules: a network keeps at least one group (to stop broadcasting it, disable it). A network on
**All access points** / **Todos los puntos de acceso** stays read-only here (the app never turns it
into a list of groups; change it in the Omada web interface), and so does a network with
**Unknown scope** / **Alcance desconocido**. For a network that uses MLO, adding groups is refused
until the controller reports the groups' MLO room; removing groups still works.

## 8. Certificate trust

Omada controllers use self-signed certificates, so the app trusts a controller's certificate on
first use and pins it:

- On the first connection, **Verify the controller certificate** / **Verificar el certificado del
  controlador** shows the controller and the certificate's SHA-256 fingerprint. Compare it with the
  controller's certificate, then click **Trust and connect** / **Confiar y conectar**. No password
  is sent before you do.
- If the controller later presents another certificate, **Controller certificate changed** /
  **El certificado del controlador ha cambiado** shows both fingerprints and the app does not
  connect. If you expected the change (for example, the controller's certificate was regenerated),
  open **Settings** / **Ajustes**, click **Reset trusted certificate** / **Restablecer certificado
  de confianza**, confirm with **Reset** / **Restablecer**, and connect again.
- Settings shows the pinned fingerprint under **Trusted certificate (SHA-256)** /
  **Certificado de confianza (SHA-256)**.

## 9. Keyboard shortcuts

| Keys | Action |
|---|---|
| `Cmd+F` (macOS) / `Ctrl+F` | Focus the current view's search (not while a dialog is open). |
| `Escape` | Clear the current search; otherwise close the open dialog, as Cancel does (in Settings it first cancels an open confirmation). |
| Arrow keys, `Home`, `End` | Move through lists, including the lists inside dialogs. |
| `Space` | Tick or untick the focused checkbox. |
| Shift-click, `Shift` + arrow keys | Select a range of access points. |
| `Enter` on an access point's checkbox | Open its details. |
| `Enter` on a destination | Review the move to it. |

Destructive confirmations always open on Cancel, never on the destructive button.

## 10. Good to know

- The app never invents a value: what the controller does not report clearly reads as unknown, and
  the actions that would depend on it are refused with the reason.
- Moves use the controller's internal API (the same call the Omada web interface makes); management
  uses the Open API. The management features were built against the controller's documented API and
  tested on fixtures; they have not been verified on a live controller yet (that is the manual
  [live-test checklist](live-test-checklist.md), not run so far).
- Configuration lives in `~/.omada-wlan-manager/config.json`; the password and the Client Secret are
  stored encrypted (see the README).
