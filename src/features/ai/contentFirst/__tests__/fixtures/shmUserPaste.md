# Simple Harmonic Motion (SHM)

Simple harmonic motion (SHM) is a type of periodic motion in which an object oscillates about a stable equilibrium position.

Examples include a mass attached to a spring, a pendulum swinging through small angles, and the vibrations of atoms in a solid.

The defining feature of SHM is that **the acceleration is directly proportional to displacement from equilibrium and always directed towards equilibrium**.

$$
a=-\omega^{2}x
$$

Here:

- $a$ is acceleration.
- $x$ is displacement from equilibrium.
- $\omega$ is angular frequency, measured in radians per second.

The negative sign indicates that acceleration always acts in the opposite direction to displacement.

## 1. The Restoring Force

Consider a mass attached to an ideal spring on a frictionless horizontal surface.

When the mass is displaced from equilibrium, the spring exerts a restoring force that attempts to return the mass to its equilibrium position.

Hooke's law describes this force:

$$
F=-kx
$$

where $F$ is the restoring force, $k$ is the spring constant and $x$ is the displacement from equilibrium.

- When the mass is displaced to the right, the restoring force acts to the left.
- When the mass is displaced to the left, the restoring force acts to the right.
- At equilibrium, the restoring force is zero.

The mass does not simply stop when it reaches equilibrium. It has velocity at that point and therefore continues moving, causing the spring to exert a restoring force in the opposite direction.

This produces repeated oscillations.

## 2. Deriving the Equation of Motion

We can derive the equation describing SHM by combining Hooke's law with Newton's second law.

Newton's second law gives:

$$
F=ma=m\frac{d^{2}x}{dt^{2}}
$$

Substituting Hooke's law:

$$
\begin{aligned}
m\frac{d^{2}x}{dt^{2}}&=-kx\\
\frac{d^{2}x}{dt^{2}}&=-\frac{k}{m}x\\
\frac{d^{2}x}{dt^{2}}+\frac{k}{m}x&=0
\end{aligned}
$$

We define the angular frequency as:

$$
\omega=\sqrt{\frac{k}{m}}
$$

This gives the standard SHM differential equation:

$$
\boxed{\frac{d^{2}x}{dt^{2}}+\omega^{2}x=0}
$$

This is a second-order linear differential equation whose solutions are sinusoidal functions.

## 3. Displacement, Velocity and Acceleration

### Displacement

The general solution can be expressed as:

$$
x(t)=A\cos(\omega t+\phi)
$$

where:

- $A$ is the amplitude, or maximum displacement.
- $\omega$ is the angular frequency.
- $t$ is time.
- $\phi$ is the phase constant, determined by the initial conditions.

The displacement oscillates between $+A$ and $-A$.

### Velocity

Velocity is the first derivative of displacement with respect to time.

Differentiating:

$$
\begin{aligned}
v(t)&=\frac{dx}{dt}\\
&=-A\omega\sin(\omega t+\phi)
\end{aligned}
$$

The maximum speed is:

$$
v_{\max}=A\omega
$$

The speed is greatest when the mass passes through equilibrium and zero at the turning points.

### Acceleration

Acceleration is the second derivative of displacement.

Differentiating again:

$$
\begin{aligned}
a(t)&=\frac{d^{2}x}{dt^{2}}\\
&=-A\omega^{2}\cos(\omega t+\phi)\\
&=-\omega^{2}x(t)
\end{aligned}
$$

The maximum magnitude of acceleration is:

$$
a_{\max}=A\omega^{2}
$$

Acceleration is greatest in magnitude at the turning points and zero at equilibrium.

### Graphical Representation

The following graph shows displacement, velocity and acceleration for unit amplitude and angular frequency, with zero initial phase.

:::graph
title: Displacement, Velocity and Acceleration in SHM
expression: cos(x)
expression: -sin(x)
expression: -cos(x)
x_min: 0
x_max: 12.57
y_min: -1.5
y_max: 1.5
x_label: Phase (radians)
y_label: Normalised displacement, velocity and acceleration
:::

Notice that:

- Velocity is shifted in phase by $\pi/2$ relative to displacement.
- Acceleration is exactly opposite in phase to displacement.
- When displacement is maximum, velocity is zero.
- When displacement is zero, the speed is maximum.

## 4. Period and Frequency

The period $T$ is the time required to complete one full oscillation.

The frequency $f$ is the number of complete oscillations per second.

They are related by:

$$
f=\frac{1}{T}
$$

Angular frequency is related to both:

$$
\omega=2\pi f=\frac{2\pi}{T}
$$

For a mass-spring system, substituting $\omega=\sqrt{k/m}$ gives:

$$
\boxed{T=2\pi\sqrt{\frac{m}{k}}}
$$

This equation tells us that:

- Increasing the mass increases the period.
- Increasing the spring constant decreases the period.
- For an ideal spring, the period does not depend on amplitude.

## 5. Energy in Simple Harmonic Motion

In ideal SHM, mechanical energy is continuously exchanged between kinetic and potential energy.

### Potential Energy

For an ideal spring, elastic potential energy is:

$$
U=\frac{1}{2}kx^{2}
$$

Potential energy is greatest at maximum displacement and zero at equilibrium.

### Kinetic Energy

Kinetic energy is:

$$
K=\frac{1}{2}mv^{2}
$$

Substituting the velocity equation:

$$
K=\frac{1}{2}mA^{2}\omega^{2}\sin^{2}(\omega t+\phi)
$$

Since $m\omega^{2}=k$, this becomes:

$$
K=\frac{1}{2}kA^{2}\sin^{2}(\omega t+\phi)
$$

### Total Energy

Adding kinetic and potential energy:

$$
\begin{aligned}
E&=K+U\\
&=\frac{1}{2}kA^{2}\sin^{2}(\omega t+\phi)\\
&\quad+\frac{1}{2}kA^{2}\cos^{2}(\omega t+\phi)\\
&=\frac{1}{2}kA^{2}
\end{aligned}
$$

Therefore:

$$
\boxed{E=\frac{1}{2}kA^{2}}
$$

The total mechanical energy remains constant when no dissipative forces are present.

:::graph
title: Energy Exchange During SHM
expression: 0.5*sin(x)**2
expression: 0.5*cos(x)**2
expression: 0.5
x_min: 0
x_max: 6.283
y_min: 0
y_max: 0.65
x_label: Phase (radians)
y_label: Energy divided by kA squared
:::

The first curve represents kinetic energy, the second potential energy, and the horizontal line total mechanical energy.

When kinetic energy increases, potential energy decreases by the same amount.

## 6. Worked Example

:::example
A mass of $0.50\,\mathrm{kg}$ is attached to a spring with spring constant $200\,\mathrm{N/m}$.

The mass is displaced by $0.10\,\mathrm{m}$ and released from rest.

Calculate its angular frequency, period, maximum speed and total energy.

### Step 1: Angular Frequency

$$
\begin{aligned}
\omega&=\sqrt{\frac{k}{m}}\\
&=\sqrt{\frac{200}{0.50}}\\
&=20\,\mathrm{rad/s}
\end{aligned}
$$

### Step 2: Period

$$
\begin{aligned}
T&=\frac{2\pi}{\omega}\\
&=\frac{2\pi}{20}\\
&\approx0.314\,\mathrm{s}
\end{aligned}
$$

### Step 3: Maximum Speed

$$
\begin{aligned}
v_{\max}&=A\omega\\
&=0.10(20)\\
&=2.0\,\mathrm{m/s}
\end{aligned}
$$

### Step 4: Total Energy

$$
\begin{aligned}
E&=\frac{1}{2}kA^{2}\\
&=\frac{1}{2}(200)(0.10)^{2}\\
&=1.0\,\mathrm{J}
\end{aligned}
$$

The system has a period of approximately $0.314\,\mathrm{s}$, a maximum speed of $2.0\,\mathrm{m/s}$ and a constant mechanical energy of $1.0\,\mathrm{J}$.
:::

## 7. Conditions and Limitations

Not every oscillating system undergoes simple harmonic motion.

For ideal SHM, the restoring force must be proportional to displacement and directed towards equilibrium:

$$
F=-kx
$$

Real systems may deviate from SHM because of friction, air resistance, nonlinear restoring forces or external driving forces.

### Example: The Simple Pendulum

A simple pendulum approximately undergoes SHM for small angular displacements.

The exact restoring torque about the pivot is:

$$
\tau=-mgL\sin\theta
$$

For small angles measured in radians, we can use:

$$
\sin\theta\approx\theta
$$

Using the moment of inertia $I=mL^{2}$ for a point mass at distance $L$:

$$
\begin{aligned}
I\ddot{\theta}&=\tau\\
mL^{2}\ddot{\theta}&\approx-mgL\theta\\
\ddot{\theta}+\frac{g}{L}\theta&=0
\end{aligned}
$$

This has the same mathematical form as the SHM differential equation.

Therefore:

$$
\omega=\sqrt{\frac{g}{L}}
$$

and:

$$
\boxed{T=2\pi\sqrt{\frac{L}{g}}}
$$

Here, $L$ is the pendulum length and $g$ is gravitational acceleration.

For small oscillations, the period is approximately independent of amplitude.

## 8. Summary

The central idea behind simple harmonic motion is that acceleration is proportional to displacement and directed towards equilibrium.

The most important equations are:

$$
\begin{aligned}
a&=-\omega^{2}x\\
x(t)&=A\cos(\omega t+\phi)\\
v(t)&=-A\omega\sin(\omega t+\phi)\\
T&=\frac{2\pi}{\omega}\\
E&=\frac{1}{2}kA^{2}
\end{aligned}
$$

These equations describe the motion, timing and energy of an ideal harmonic oscillator.

Understanding SHM provides a foundation for studying waves, vibrations, resonance and oscillating systems throughout physics.
