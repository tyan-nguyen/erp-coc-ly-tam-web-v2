'use client'

import { useEffect } from 'react'

function shouldClearValue(rawValue: string) {
  const value = rawValue.trim()
  return /^0(?:\.0+)?$/.test(value)
}

function setNativeInputValue(input: HTMLInputElement, nextValue: string) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
  const setter = descriptor?.set

  if (setter) {
    setter.call(input, nextValue)
  } else {
    input.value = nextValue
  }
}

export function ClearZeroNumberInputs() {
  useEffect(() => {
    function handleFocusIn(event: FocusEvent) {
      const target = event.target
      if (!(target instanceof HTMLInputElement)) return
      if (target.type !== 'number') return
      if (target.disabled || target.readOnly) return
      if (!shouldClearValue(target.value)) return

      setNativeInputValue(target, '')
      target.dispatchEvent(new Event('input', { bubbles: true }))
    }

    document.addEventListener('focusin', handleFocusIn)
    return () => document.removeEventListener('focusin', handleFocusIn)
  }, [])

  return null
}
