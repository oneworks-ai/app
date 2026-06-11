export const relayLoginResponsiveStyle = `
.relay-login__error {
  margin: 0;
  padding: 20px 30px 30px;
  color: var(--relay-warning);
  font-size: 14px;
  line-height: 1.6;
}

@media (prefers-reduced-motion: reduce) {
  .relay-login__layout {
    transition: none;
  }
}

@media (max-width: 560px) {
  .relay-login {
    padding: 18px;
  }

  .relay-login__layout {
    width: min(100%, 424px);
  }

  .relay-login__header {
    padding: 22px 22px 18px;
  }

  .relay-login__title {
    font-size: 25px;
  }
}

@media (max-width: 390px) {
  .relay-login {
    padding: 12px;
  }

  .relay-login__header {
    padding: 20px 18px 16px;
  }

}
`
