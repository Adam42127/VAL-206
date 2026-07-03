// ─────────────────────────────────────────────────────────────────────────────
// ──────────────── metro-autopilot.js ─────────────────────────────────────────
// ─────────── Pilote automatique pour ValADAM ─────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

class MetroAutopilot {

    constructor() {
        this.active         = false;
        this._state         = 'IDLE';
        this._timer         = null;
        this._btn           = null;
        this._cruiseSpeed   = 70;    // vitesse de croisière choisie à chaque interstation
        this._ppTarget             = 0;
        this._wasStoppingAtStation = false;
        this._lastDist             = null;
        this._passedZero           = false;
        this._loop          = this._loop.bind(this);
    }

    // ─── Init ─────────────────────────────────────────────────────────────────

    init() {
        this._injectButton();
        this._injectStyles();
        requestAnimationFrame(this._loop);
    }

    _injectButton() {
        const btn = document.createElement('button');
        btn.id          = 'autoBtn';
        btn.className   = 'btn';
        btn.textContent = 'AUTO';
        btn.title       = 'Pilote automatique';

        const brakeBtn = document.getElementById('brakeBtn');
        brakeBtn.parentNode.insertBefore(btn, brakeBtn.nextSibling);

        btn.addEventListener('click', () => this.toggle());
        this._btn = btn;
        this._setButtonState(false);
    }

    _injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            #autoBtn {
                padding: 8px 10px;
                font-size: 11px;
                border-radius: 5px;
                min-width: 44px;
                color: #fff;
                font-weight: bold;
                transition: background 0.3s;
            }
            #controls.auto-locked > *:not(#autoBtn) {
                opacity: 0.35;
                pointer-events: none;
            }
        `;
        document.head.appendChild(style);
    }

    _setButtonState(active) {
        this._btn.style.background = active ? '#0c0' : '#00f';
    }

    // ─── Activation / désactivation ───────────────────────────────────────────

    toggle() {
        if (!this.active) {
            this._activate();
        } else {
            this._deactivate();
        }
    }

    _activate() {
        this.active = true;
        this._setButtonState(true);
        this._lockControls(true);
        const d = this._lastDist;
        if (d !== null && d <= 1.10 && d >= -3.00) {
            this._wasStoppingAtStation = true;
        }
        emergencyStop();
        this._setState('EMERGENCY');
    }

    _deactivate() {
        this.active = false;
        this._setButtonState(false);
        this._lockControls(false);
        this._clearTimer();
        this._setState('IDLE');
        emergencyStop();
    }

    _lockControls(locked) {
        const controls = document.getElementById('controls');
        if (locked) {
            controls.classList.add('auto-locked');
        } else {
            controls.classList.remove('auto-locked');
        }
    }

    // ─── Machine d'états ──────────────────────────────────────────────────────

    _setState(s) {
        this._state = s;
        console.log('[AUTO]', s);
    }

    _loop() {
        requestAnimationFrame(this._loop);
        const spd     = state.speed;
        const rawDist = getNextStation();
        const dist    = rawDist !== null ? rawDist * 0.0224 : null;
        if (dist !== null && dist < 200) this._lastDist = dist;
        if (dist !== null && dist > 0.8) this._lastDist = null;
        if (this._state === 'PP_ZONE' && dist !== null && dist <= 0.1) this._passedZero = true;
        if (!this.active) return; // mémoriser tant que proche

        switch (this._state) {

            // ── FU initial : attendre arrêt complet ──────────────────────────
            case 'EMERGENCY':
                if (spd === 0 && !state.fuActive) {
                    const inPP = this._lastDist !== null
                        ? (this._lastDist <= 1.10 && this._lastDist >= -3.00)
                        : (dist !== null && dist <= 1.10 && dist >= -3.00);

                    if (inPP) {
                        this._wasStoppingAtStation = false;
                        this._passedZero = false;
                        this._setState('AT_STATION');
                        this._startDoorSequence();
                    } else if (this._wasStoppingAtStation && dist !== null && dist < 50) {
                        // Arrêté hors zone PP après FU → recalage CREEPING
                        this._wasStoppingAtStation = false;
                        this._setState('CREEPING');
                        releaseBrakes();
                    } else if (dist !== null && dist > 1.10 && dist < 15) {
                        this._setState('CREEPING');
                        releaseBrakes();
                    } else {
                        this._wasStoppingAtStation = false;
                        this._cruiseSpeed = this._chooseCruiseSpeed(dist);
                        this._stopOffset  = (Math.random() * 2 - 1);
                        this._setState('RELEASING_BRAKES');
                        releaseBrakes();
                        this._timer = setTimeout(() => {
                            this._setHandle(5);
                            this._setState('ACCELERATING');
                        }, 1000);
                    }
                }
                break;

            case 'CREEPING':
                if (dist !== null && dist <= 0.90) {
                    // Entré dans la zone → basculer en PP_ZONE
                    this._passedZero = false;
                    this._setState('PP_ZONE');
                    break;
                }
                if (dist !== null && dist < -3.00) {
                    emergencyStop();
                    this._setState('EMERGENCY');
                    break;
                }
                if (spd < 5) {
                    this._setHandle(1);
                } else {
                    this._setHandle(0);
                }
                break;

            // ── En station : géré par callbacks/timers ───────────────────────
            case 'AT_STATION':
            case 'DOORS_OPENING':
            case 'DWELL':
            case 'DOORS_CLOSING':
            case 'RELEASING_BRAKES':
                break;

            // ── Accélération ─────────────────────────────────────────────────
            case 'ACCELERATING':
                if (spd > 5 && dist !== null) {
                    const brakeDist = this._estimateBrakingDistance(spd, 5);
                    if (dist - 0.90 <= brakeDist) {
                        this._wasStoppingAtStation = true;
                        this._setHandle(-5);
                        this._setState('BRAKING');
                        break;
                    }
                }
                if (spd >= this._cruiseSpeed) {
                    this._setHandle(0);
                    this._setState('CRUISING');
                }
                break;

            case 'CRUISING':
                if (spd > 5 && dist !== null) {
                    const brakeDist = this._estimateBrakingDistance(spd, 5);
                    if (dist - 0.90 <= brakeDist) {
                        this._wasStoppingAtStation = true;
                        this._setHandle(-5);
                        this._setState('BRAKING');
                    }
                }
                if (spd < this._cruiseSpeed - 1 && state.accelLevel === 0) {
                    this._setHandle(5);
                    this._setState('ACCELERATING');
                }
                break;

            case 'BRAKING': {
                if (spd === 0) {
                    this._setHandle(0);
                    this._setState('AT_STATION');
                    this._startDoorSequence();
                    break;
                }
                if (dist !== null) {
                    if (dist <= 0.90) {
                        this._setState('PP_ZONE');
                    } else {
                        this._setHandle(-5);
                    }
                }
                break;
            }

            case 'PP_ZONE': {
                if (spd === 0) {
                    this._passedZero = false;
                    this._setHandle(0);
                    this._setState('AT_STATION');
                    this._startDoorSequence();
                    break;
                }
                if (dist !== null && dist < -3.00) {
                    this._setHandle(-6);
                } else if (this._passedZero) {
                    this._setHandle(-5);
                } else if (spd <= 1.5) {
                    this._setHandle(0);
                } else {
                    this._setHandle(-5);
                }
                break;
            }
        }
    }

    // ─── Séquence station ─────────────────────────────────────────────────────

    _startDoorSequence() {
        this._timer = setTimeout(() => {
            this._setState('DOORS_OPENING');
            openDoors();

            this._timer = setTimeout(() => {
                this._setState('DOORS_CLOSING');
                closeDoors();
                this._waitForFerPrt();
            }, 5000);
        }, 400);
    }

    _waitForFerPrt() {
        // closeDoors joue d'abord buzzer, puis lance fer_prt.
        // On attend que fer_prt soit actif puis on écoute onended.
        const poll = () => {
            const ferPrt = soundManager._door['fer_prt'];
            if (ferPrt && !ferPrt.paused) {
                ferPrt.onended = () => {
                    ferPrt.onended = null;
                    this._afterDoorsClose();
                };
            } else {
                this._timer = setTimeout(poll, 100);
            }
        };
        this._timer = setTimeout(poll, 300);
    }

    _afterDoorsClose() {
        this._setState('RELEASING_BRAKES');

        // Choisir la vitesse et le décalage d'arrêt pour la prochaine interstation
        const rawDist = getNextStation();
        const dist    = rawDist !== null ? rawDist * 0.0224 : null;
        this._cruiseSpeed = this._chooseCruiseSpeed(dist);
        this._stopOffset  = (Math.random() * 2 - 1); // -1m à +1m

        console.log(`[AUTO] Prochain arrêt : croisière ${this._cruiseSpeed} km/h, offset ${this._stopOffset.toFixed(2)} m`);

        // Attendre 1s après la fin de fer_prt avant de desserrer et repartir
        this._timer = setTimeout(() => {
            releaseBrakes();
            this._timer = setTimeout(() => {
                this._setHandle(5);
                this._setState('ACCELERATING');
            }, 1000);
        }, 1000);
    }

    // ─── Physique ─────────────────────────────────────────────────────────────

    /**
     * Simule le freinage frame par frame.
     * Niveau 6 = FU (2× niveau 5), uniquement pour la simulation du pilote.
     */
    _estimateBrakingDistance(currentSpeed, brakeLevel) {
        let speed = currentSpeed;
        let dist  = 0;
        const lvl = Math.abs(brakeLevel);

        while (speed > 0.01) {
            let power;
            if (lvl === 6) {
                // Niveau virtuel FU : 2× la puissance du niveau 5
                power = 5 * CONFIG.acceleration * CONFIG.deceleration * (CONFIG.level5Multiplier || 1.5) * 2;
            } else if (lvl === 5) {
                power = lvl * CONFIG.acceleration * CONFIG.deceleration * (CONFIG.level5Multiplier || 1.5);
            } else {
                power = lvl * CONFIG.acceleration * CONFIG.deceleration;
            }

            speed = Math.max(0, speed - power);
            dist += (speed / CONFIG.maxSpeed) * CONFIG.scrollMultiplier * 0.0224;
        }
        return dist;
    }

    /**
     * Trouve le niveau de freinage optimal (2 à 6).
     * Niveau 1 exclu : trop doux, risque de dépassement au dernier moment.
     * Niveau 6 = FU virtuel, déclenche emergencyStop().
     * Tolérance 0% : on ne joue pas avec la marge.
     */
    _getOptimalBrakeLevel(speed, eDist) {
        for (let lvl = 2; lvl <= 6; lvl++) {
            const d = this._estimateBrakingDistance(speed, lvl);
            if (d <= eDist) {
                return lvl;
            }
        }
        return 6; // même FU ne suffit pas → FU quand même
    }

    /**
     * Choisit intelligemment la vitesse de croisière selon la distance.
     */
    _chooseCruiseSpeed(distMeters) {
        return 75;
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    _setHandle(level) {
        if (level <= -6) {
            // Niveau virtuel -6 : FU
            emergencyStop();
            this._setState('EMERGENCY');
            return;
        }
        const clamped = Math.max(-5, Math.min(5, level));
        const pos     = 50 - clamped * 10;
        setHandlePos(pos);
        state.accelLevel = clamped;
    }

    _clearTimer() {
        if (this._timer !== null) {
            clearTimeout(this._timer);
            this._timer = null;
        }
    }
}

// ─── Auto-démarrage ───────────────────────────────────────────────────────────
window.addEventListener('load', () => {
    setTimeout(() => {
        window.autopilot = new MetroAutopilot();
        autopilot.init();
        console.log('[AUTO] Pilote automatique prêt');
    }, 500);
});
