// ─── metro-autopilot.js ──────────────────────────────────────────────────────
// Pilote automatique pour ValADAM
// À inclure dans index.html APRÈS metro-sound-manager.js :
//   <script src="metro-autopilot.js"></script>
// ─────────────────────────────────────────────────────────────────────────────

class MetroAutopilot {

    constructor() {
        this.active         = false;
        this._state         = 'IDLE';
        this._timer         = null;
        this._btn           = null;
        this._cruiseSpeed   = 70;    // vitesse de croisière choisie à chaque interstation
        this._stopOffset    = 0;     // décalage aléatoire d'arrêt en mètres (-1 à +1)
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
        if (!this.active) return;

        const spd     = state.speed;
        const rawDist = getNextStation();
        const dist    = rawDist !== null ? rawDist * 0.0224 : null; // mètres

        switch (this._state) {

            // ── FU initial : attendre arrêt complet ──────────────────────────
            case 'EMERGENCY':
                if (spd === 0 && !state.fuActive) {
                    // Ouverture autorisée uniquement si on est dans ±1m du point d'arrêt
                    if (dist !== null && dist <= 1) {
                        this._setState('AT_STATION');
                        this._startDoorSequence();
                    } else {
                        // Hors station → choisir vitesse et partir
                        this._cruiseSpeed = this._chooseCruiseSpeed(dist);
                        this._setState('RELEASING_BRAKES');
                        releaseBrakes();
                        this._timer = setTimeout(() => {
                            this._setHandle(5);
                            this._setState('ACCELERATING');
                        }, 1000);
                    }
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
                // Vérifier si on doit déjà freiner (station proche)
                if (dist !== null) {
                    const brakeDist = this._estimateBrakingDistance(spd, 5) * 1.10;
                    if (dist - this._stopOffset <= brakeDist) {
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

            // ── Croisière : surveiller le moment de freiner ──────────────────
            case 'CRUISING':
                if (dist !== null) {
                    // Déclencher le freinage quand la distance restante ≤ distance d'arrêt à -5
                    // + 10% de marge de sécurité pour ne pas arriver à court
                    const brakeDist = this._estimateBrakingDistance(spd, 5) * 1.10;
                    if (dist - this._stopOffset <= brakeDist) {
                        this._setHandle(-5);
                        this._setState('BRAKING');
                    }
                }
                // Rattrapage léger si on a décéléré sous la croisière
                if (spd < this._cruiseSpeed - 1 && state.accelLevel === 0) {
                    this._setHandle(5);
                    this._setState('ACCELERATING');
                }
                break;

            // ── Freinage intelligent ──────────────────────────────────────────
            case 'BRAKING': {
                if (spd === 0) {
                    this._setHandle(0);
                    this._setState('AT_STATION');
                    this._startDoorSequence();
                    break;
                }

                if (dist !== null) {
                    // Distance effective jusqu'au point d'arrêt cible (avec décalage aléatoire)
                    const eDist = Math.max(0, dist - this._stopOffset);
                    const optLevel = this._getOptimalBrakeLevel(spd, eDist);
                    this._setHandle(-optLevel);
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
        releaseBrakes();

        // Choisir la vitesse et le décalage d'arrêt pour la prochaine interstation
        const rawDist = getNextStation();
        const dist    = rawDist !== null ? rawDist * 0.0224 : null;
        this._cruiseSpeed = this._chooseCruiseSpeed(dist);
        this._stopOffset  = (Math.random() * 2 - 1); // -1m à +1m

        console.log(`[AUTO] Prochain arrêt : croisière ${this._cruiseSpeed} km/h, offset ${this._stopOffset.toFixed(2)} m`);

        this._timer = setTimeout(() => {
            this._setHandle(5);
            this._setState('ACCELERATING');
        }, 1000);
    }

    // ─── Physique ─────────────────────────────────────────────────────────────

    /**
     * Simule le freinage frame par frame.
     * Retourne la distance parcourue (mètres) avant arrêt depuis currentSpeed au niveau brakeLevel.
     * Reproduit exactement la physique de updateSpeed().
     */
    _estimateBrakingDistance(currentSpeed, brakeLevel) {
        let speed = currentSpeed;
        let dist  = 0;
        const lvl = Math.abs(brakeLevel);

        while (speed > 0.01) {
            const power = (lvl === 5)
                ? lvl * CONFIG.acceleration * CONFIG.deceleration * (CONFIG.level5Multiplier || 1.5)
                : lvl * CONFIG.acceleration * CONFIG.deceleration;

            speed  = Math.max(0, speed - power);
            dist  += (speed / CONFIG.maxSpeed) * CONFIG.scrollMultiplier * 0.0224;
        }
        return dist; // en mètres
    }

    /**
     * Trouve le niveau de freinage le plus doux tel que la distance d'arrêt
     * soit ≤ eDist (on ne dépasse pas la cible).
     * C'est le niveau "juste ce qu'il faut", ni trop fort ni trop doux.
     */
    _getOptimalBrakeLevel(speed, eDist) {
        // On cherche le niveau le plus faible (1=doux → 5=fort)
        // dont la distance d'arrêt reste ≤ eDist.
        // Si même -1 ne suffit pas (on s'arrête trop tôt) → on relâche tout → -1
        // Si même -5 ne suffit pas (on va dépasser) → -5 max
        for (let lvl = 1; lvl <= 5; lvl++) {
            const d = this._estimateBrakingDistance(speed, lvl);
            if (d <= eDist * 1.03) {
                // Ce niveau nous arrête pile ou légèrement avant → c'est le bon
                return lvl;
            }
        }
        return 5; // même à -5 on va dépasser → max
    }

    /**
     * Choisit intelligemment la vitesse de croisière selon la distance jusqu'à la prochaine station.
     * Ajoute une légère variation aléatoire pour le réalisme.
     */
    _chooseCruiseSpeed(distMeters) {
        const jitter = Math.round((Math.random() - 0.5) * 6); // ±3 km/h
        let base;
        if (distMeters === null || distMeters > 700) {
            base = 74;
        } else if (distMeters > 500) {
            base = 70;
        } else if (distMeters > 300) {
            base = 65;
        } else {
            base = 61;
        }
        // Clamp entre 60 et 75 km/h
        return Math.min(75, Math.max(60, base + jitter));
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    _setHandle(level) {
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