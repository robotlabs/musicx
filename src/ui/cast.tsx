// "Trasmetti": dove suona musicx. Questo dispositivo o una cassa di casa; con le MusicCast si possono
// collegare altre stanze, ognuna col suo volume.

import { useEffect, useRef, useState } from 'react'
import { castBackend, needsNewApp } from '../lib/cast/backend'
import { devicesStore, knownDevices, searchDevices, type Device } from '../lib/cast/devices'
import { castStore, remote, type CastTarget } from '../lib/cast/remote'
import { ANDROID_APP_URL, isNativeApp } from '../lib/native'
import { castTo } from '../lib/player'
import { useStore } from '../lib/store'
import { Icon } from './icons'
import { showSheet, toast } from './sheets'
import { errorText } from './text'

/** Da qui si può trasmettere (Mac col servizio di musicx, app Android). */
export const canCast = () => castBackend() !== null

/** "Soggiorno", "Soggiorno + Camera". */
export const castLabel = (target: CastTarget) => [target.device, ...target.rooms].map((device) => device.name).join(' + ')

export function openCastSheet() {
  showSheet(<CastSheet />)
}

/** Fa vedere una volta i problemi della trasmissione (stanze non collegate, cassa persa). */
export function useCastErrors() {
  const error = useStore(castStore, (state) => state.error)
  useEffect(() => {
    if (error) toast(error)
  }, [error])
}

function Volume({ device }: { device: Device }) {
  const [volume, setVolume] = useState<{ value: number; max: number } | null>(null)
  const timer = useRef(0)
  useEffect(() => {
    let alive = true
    remote
      .volume(device)
      .then((value) => alive && setVolume(value))
      .catch(() => {})
    return () => {
      alive = false
    }
    // La stessa cassa ritrovata da una nuova ricerca è un oggetto nuovo: conta l'indirizzo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.ip])
  if (!volume) return null
  const change = (value: number) => {
    setVolume({ ...volume, value })
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void remote.setVolume(device, value).catch((error) => toast(errorText(error))), 200)
  }
  return (
    <div className="cast-volume">
      <Icon name="volume" size={16} />
      <input
        type="range"
        aria-label={`Volume di ${device.name}`}
        min={0}
        max={volume.max}
        step={1}
        value={volume.value}
        onChange={(event) => change(Number(event.target.value))}
      />
    </div>
  )
}

function CastSheet() {
  const { devices, searching, problem } = useStore(devicesStore)
  const target = useStore(castStore, (state) => state.target)
  const status = useStore(castStore, (state) => state.status)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    knownDevices()
    void searchDevices()
  }, [])

  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key)
    try {
      await task()
    } catch (error) {
      toast(errorText(error))
    } finally {
      setBusy(null)
    }
  }
  const choose = (device: Device | null) => {
    if (device ? target?.device.ip === device.ip : !target) return
    void run(device?.ip ?? 'here', () => castTo(device ? { device, rooms: [] } : null))
  }
  const toggleRoom = (room: Device) => {
    if (!target) return
    const linked = target.rooms.some((other) => other.ip === room.ip)
    const rooms = linked ? target.rooms.filter((other) => other.ip !== room.ip) : [...target.rooms, room]
    void run(room.ip, () => castTo({ device: target.device, rooms }))
  }

  const here = isNativeApp ? 'Questo telefono' : 'Questo Mac'
  const sub = target
    ? `${status === 'connecting' ? 'Collego' : 'In riproduzione su'} ${castLabel(target)}`
    : 'Scegli dove suona musicx'

  return (
    <div className="cast-sheet">
      <header className="sheet-head">
        <div className="sheet-title">Trasmetti</div>
        <div className="sheet-sub">{sub}</div>
      </header>
      <ul className="menu cast-list">
        <li>
          <button className={target ? '' : 'on'} onClick={() => choose(null)}>
            <Icon name={isNativeApp ? 'phone' : 'laptop'} />
            <span>{here}</span>
            {busy === 'here' ? <span className="spinner small" /> : !target && <Icon name="check" />}
          </button>
        </li>
        {devices.map((device) => {
          const main = target?.device.ip === device.ip
          const linked = !!target?.rooms.some((room) => room.ip === device.ip)
          // Le altre MusicCast si collegano alla cassa che suona.
          const linkable = !!target && !main && target.device.yamaha && device.yamaha
          return (
            <li key={device.ip} className="cast-device">
              <div className="cast-row">
                <button className={main ? 'on' : ''} onClick={() => choose(device)}>
                  <Icon name="speaker" />
                  <span>
                    {device.name}
                    {device.model && <small>{device.model}</small>}
                  </span>
                  {busy === device.ip && !linkable ? <span className="spinner small" /> : main && <Icon name="check" />}
                </button>
                {linkable && (
                  <label className="cast-link" title={`Suona anche in ${device.name}`}>
                    {busy === device.ip ? (
                      <span className="spinner small" />
                    ) : (
                      <input
                        type="checkbox"
                        aria-label={`Suona anche in ${device.name}`}
                        checked={linked}
                        onChange={() => toggleRoom(device)}
                      />
                    )}
                    <span>Anche qui</span>
                  </label>
                )}
              </div>
              {(main || linked) && <Volume device={device} />}
            </li>
          )
        })}
      </ul>
      {searching && (
        <p className="menu-note cast-searching">
          <span className="spinner small" /> Cerco le casse…
        </p>
      )}
      {!searching && problem && <p className="menu-note">{problem}</p>}
      <div className="dialog-actions cast-actions">
        {needsNewApp() && (
          <button className="primary" onClick={() => location.assign(ANDROID_APP_URL)}>
            Scarica l'app nuova
          </button>
        )}
        <button disabled={searching} onClick={() => void searchDevices()}>
          Cerca di nuovo
        </button>
      </div>
    </div>
  )
}
